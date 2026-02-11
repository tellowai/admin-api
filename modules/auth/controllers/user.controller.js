'use strict';

var HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
var UserDbo = require('../dbo/user.dbo');
const moment = require('moment');
const tr46 = require('tr46');
const RbacModel = require('../models/rbac.model');


/**
 * @api {get} /me Get logged in user data
 * @apiGroup User
 *
 * @apiSuccess {String} user_id User id
 * @apiSuccess {String} username Username of the user
 * @apiSuccess {String} email Email id of user
 * @apiSuccess {String} mobile Mobile number of user (if available)
 * @apiSuccess {String} profile_pic Profile pic of user
 * @apiSuccess {String} cover_pic Cover pic of user
 * @apiSuccess {String} first_name First name of user
 * @apiSuccess {String} middle_name Middle name of user (if available)
 * @apiSuccess {String} last_name Last name of user
 * @apiSuccess {String} display_name Display name of user
 * @apiSuccess {String} gender Gender of user (if available)
 * @apiSuccess {String} dob Date of birth of user (if available)
 * @apiSuccess {String} bio Biography of user
 * @apiSuccess {Number} total_posts Total posts made by user
 * @apiSuccess {Number} total_following Total number of users the user is following
 * @apiSuccess {Number} total_followers Total number of followers of the user
 * @apiSuccess {String} last_seen_notifications_at Last time user saw notifications
 * @apiSuccess {String} created_at Account created date
 * @apiSuccess {String} notification_last_received_at Last time user received a notification
 * @apiSuccess {Boolean} has_new_notifications Indicates if there are new notifications
 */

exports.getLoggedInUserData = async function (req, res) {

  var userId = req.user.userId;
  var options = {
    select: [
      'user_id',
      'email',
      'mobile',
      'profile_pic',
      'first_name',
      'middle_name',
      'last_name',
      'display_name',
      'gender',
      'dob',
      'last_seen_notifications_at',
      'created_at'
    ]
  };

  const loggedInUserData = await UserDbo.getUserByUserId(userId, options);

  if (!loggedInUserData) {
    return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
      message: 'User not found or inactive'
    });
  }

  if (loggedInUserData.mobile) {
    loggedInUserData.phone = loggedInUserData.mobile;
  }

  if (loggedInUserData.dob) {
    loggedInUserData.dob = moment(loggedInUserData.dob).format('MM/DD/YYYY');
  }

  // Fetch user roles and permissions
  try {
    const { roles, permissions } = await RbacModel.getUserRolesAndPermissions(userId);

    // Add roles and permissions to response
    loggedInUserData.roles = roles.map(r => ({
      role_id: r.role_id,
      role_name: r.role_name,
      role_description: r.role_description
    }));

    loggedInUserData.permissions = permissions.map(p => ({
      permission_id: p.admin_permission_id,
      permission_code: p.permission_code,
      permission_name: p.permission_name,
      permission_description: p.permission_description
    }));

    // Add permission codes array for easier frontend checking
    loggedInUserData.permission_codes = permissions.map(p => p.permission_code);
  } catch (error) {
    console.error('Error fetching user roles and permissions:', error);
    // Continue without roles/permissions if fetch fails
    loggedInUserData.roles = [];
    loggedInUserData.permissions = [];
    loggedInUserData.permission_codes = [];
  }

  return res.status(
    HTTP_STATUS_CODES.OK
  ).json({
    data: loggedInUserData
  });
}
