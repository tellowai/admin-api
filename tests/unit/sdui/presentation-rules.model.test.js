'use strict';

const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { expect } = require('chai');

describe('SDUI Presentation Rules Model', () => {
  let sduiPresentationRulesModel;
  let mysqlQueryRunnerMock;

  beforeEach(() => {
    mysqlQueryRunnerMock = {
      runQueryInSlave: sinon.stub(),
      runQueryInMaster: sinon.stub(),
    };

    sduiPresentationRulesModel = proxyquire('../../../modules/sdui/models/sdui.presentation-rules.model', {
      '../../core/models/mysql.promise.model': mysqlQueryRunnerMock,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getPresentationRules', () => {
    it('should return rules for a specific resource_key', async () => {
      mysqlQueryRunnerMock.runQueryInSlave.resolves([{ id: '1', rule_name: 'Color logic' }]);
      const result = await sduiPresentationRulesModel.getPresentationRules('credits_history');
      expect(result).to.deep.equal([{ id: '1', rule_name: 'Color logic' }]);
      const args = mysqlQueryRunnerMock.runQueryInSlave.getCall(0).args;
      expect(args[1]).to.deep.equal(['credits_history']);
    });
  });

  describe('createPresentationRule', () => {
    it('should stringify conditions_json and insert', async () => {
      mysqlQueryRunnerMock.runQueryInMaster.resolves();
      await sduiPresentationRulesModel.createPresentationRule({
        resource_key: 'credits',
        rule_name: 'Test',
        target_field: 'color',
        target_field_type: 'color_hex',
        conditions_json: [{ field: 'type', operator: 'equals', value: 'deduction', output: 'red' }]
      });
      
      const args = mysqlQueryRunnerMock.runQueryInMaster.getCall(0).args;
      expect(args[0]).to.include('INSERT INTO sdui_presentation_rules');
      expect(args[1][4]).to.equal('[{"field":"type","operator":"equals","value":"deduction","output":"red"}]');
    });
  });
});
