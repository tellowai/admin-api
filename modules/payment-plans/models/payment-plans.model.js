'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * List payment plans with pagination
 */
exports.listPlans = async function (pagination) {
  const query = `
    SELECT 
      pp_id,
      tier,
      plan_type,
      plan_name,
      plan_heading,
      plan_subheading,
      plan_benefits,
      original_price,
      current_price,
      currency,
      billing_interval,
      template_count,
      credits,
      validity_days,
      is_active,
      created_at,
      updated_at
    FROM payment_plans
    ORDER BY current_price ASC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [pagination.limit, pagination.offset]);
};

exports.getUIConfigsForPlans = async function (planIds) {
  if (!planIds || planIds.length === 0) return [];

  const query = `
    SELECT *
    FROM payment_plan_ui_config 
    WHERE payment_plan_id IN (?)
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [planIds]);
}

exports.getPlanById = async function (planId) {
  const query = `SELECT * FROM payment_plans WHERE pp_id = ?`;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [planId]);
  return rows[0];
}

exports.getPlanGateways = async function (planId) {
  const query = `SELECT * FROM payment_gateway_plans WHERE payment_plan_id = ?`;
  return await mysqlQueryRunner.runQueryInSlave(query, [planId]);
}

exports.getPlanUIConfig = async function (planId) {
  const query = `SELECT * FROM payment_plan_ui_config WHERE payment_plan_id = ?`;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [planId]);
  return rows[0];
}

/**
 * Create a new payment plan with all related data
 */
exports.createPlan = async function (data) {
  const conn = await mysqlQueryRunner.getConnectionFromMaster();

  try {
    await conn.beginTransaction();

    // 1. Insert into payment_plans
    const planFields = [
      'tier', 'plan_type', 'plan_name', 'plan_heading', 'plan_subheading',
      'plan_benefits', 'original_price', 'current_price', 'currency',
      'billing_interval', 'template_count', 'max_creations_per_template',
      'credits', 'bonus_credits', 'validity_days', 'is_active'
    ];

    // Filter data to only include valid fields
    const planData = {};
    planFields.forEach(field => {
      if (data[field] !== undefined) planData[field] = data[field];
    });

    if (planData.plan_benefits) {
      planData.plan_benefits = JSON.stringify(planData.plan_benefits);
    }

    const planRes = await conn.query('INSERT INTO payment_plans SET ?', planData);
    const planId = planRes.insertId;

    // 2. Insert into payment_gateway_plans
    if (data.gateways && Array.isArray(data.gateways) && data.gateways.length > 0) {
      const gatewayValues = data.gateways.map(g => [
        planId,
        g.payment_gateway,
        g.pg_plan_id,
        g.is_active !== undefined ? g.is_active : 1
      ]);

      if (gatewayValues.length > 0) {
        await conn.query(
          'INSERT INTO payment_gateway_plans (payment_plan_id, payment_gateway, pg_plan_id, is_active) VALUES ?',
          [gatewayValues]
        );
      }
    }

    // 3. Insert into payment_plan_ui_config
    if (data.ui_config) {
      const uiFields = [
        'self_selection_text', 'panel_bg_color', 'panel_glow_color',
        'panel_border_color', 'button_cta_text', 'button_bg_color',
        'button_text_color', 'plan_badge', 'plan_badge_bg_color',
        'plan_badge_border_color', 'plan_badge_text_color', 'plan_badge_icon'
      ];

      const uiData = { payment_plan_id: planId };
      let hasUiData = false;

      uiFields.forEach(field => {
        if (data.ui_config[field] !== undefined) {
          uiData[field] = data.ui_config[field];
          hasUiData = true;
        }
      });

      if (hasUiData) {
        await conn.query('INSERT INTO payment_plan_ui_config SET ?', uiData);
      }
    }

    await conn.commit();
    return planId;

  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

/**
 * Update a payment plan and related data
 */
exports.updatePlan = async function (planId, data) {
  const conn = await mysqlQueryRunner.getConnectionFromMaster();

  try {
    await conn.beginTransaction();

    // 1. Update payment_plans (excluding is_active if strict, but ignoring instructions said specifically about "updation" flow, usually implies not allowing status toggle in edit form. However, if passed, we should validly update it or ignore based on rules. User said: "do not include making it active or inactive in updation". So I will exclude is_active from update list.)
    const planFields = [
      'tier', 'plan_type', 'plan_name', 'plan_heading', 'plan_subheading',
      'plan_benefits', 'original_price', 'current_price', 'currency',
      'billing_interval', 'template_count', 'max_creations_per_template',
      'credits', 'bonus_credits', 'validity_days'
      // 'is_active' - Excluded as per instructions
    ];

    const planUpdates = {};
    let shouldUpdatePlan = false;

    planFields.forEach(field => {
      if (data[field] !== undefined) {
        planUpdates[field] = data[field];
        shouldUpdatePlan = true;
      }
    });

    if (planUpdates.plan_benefits && typeof planUpdates.plan_benefits !== 'string') {
      planUpdates.plan_benefits = JSON.stringify(planUpdates.plan_benefits);
    }

    if (shouldUpdatePlan) {
      await conn.query('UPDATE payment_plans SET ? WHERE pp_id = ?', [planUpdates, planId]);
    }

    // 2. Update payment_gateway_plans
    // Strategy: Delete existing and re-insert. Simplest for mapping tables.
    if (data.gateways !== undefined && Array.isArray(data.gateways)) {
      // Only update if gateways are provided in the payload
      await conn.query('DELETE FROM payment_gateway_plans WHERE payment_plan_id = ?', [planId]);

      if (data.gateways.length > 0) {
        const gatewayValues = data.gateways.map(g => [
          planId,
          g.payment_gateway,
          g.pg_plan_id,
          g.is_active !== undefined ? g.is_active : 1
        ]);

        await conn.query(
          'INSERT INTO payment_gateway_plans (payment_plan_id, payment_gateway, pg_plan_id, is_active) VALUES ?',
          [gatewayValues]
        );
      }
    }

    // 3. Update payment_plan_ui_config
    if (data.ui_config !== undefined) {
      const uiFields = [
        'self_selection_text', 'panel_bg_color', 'panel_glow_color',
        'panel_border_color', 'button_cta_text', 'button_bg_color',
        'button_text_color', 'plan_badge', 'plan_badge_bg_color',
        'plan_badge_border_color', 'plan_badge_text_color', 'plan_badge_icon'
      ];

      // Check if config exists
      const existingConfig = await conn.query('SELECT ui_id FROM payment_plan_ui_config WHERE payment_plan_id = ?', [planId]);

      const uiData = {};
      let hasUiData = false;
      uiFields.forEach(field => {
        if (data.ui_config[field] !== undefined) {
          uiData[field] = data.ui_config[field];
          hasUiData = true;
        }
      });

      if (hasUiData) {
        if (existingConfig.length > 0) {
          await conn.query('UPDATE payment_plan_ui_config SET ? WHERE payment_plan_id = ?', [uiData, planId]);
        } else {
          uiData.payment_plan_id = planId;
          await conn.query('INSERT INTO payment_plan_ui_config SET ?', uiData);
        }
      }
    }

    await conn.commit();
    return true;

  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};
