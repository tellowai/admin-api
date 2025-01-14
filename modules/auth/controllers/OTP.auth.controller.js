'use strict';
var SMSCtrl = require('../../core/controllers/sms.controller');
var HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
var ShortUniqueId = require('short-unique-id');
var RedisLoginOTPModel = require('../dbo/redis.otp.model');
const bcrypt = require('bcrypt');
const googlePhoneNumberValidator = require('../../user/validators/google.lib.phonenumber.validator');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const UserModel = require('../../user/models/user.model');
const logger = require('../../../config/lib/logger');

/**
 * @api {post} /profile/mobile/otp Send OTP to connect mobile number
 * @apiVersion 1.0.0
 * @apiName SendOTPToConnectMobile
 * @apiGroup Profile
 * @apiPermission JWT
 *
 * @apiDescription Send OTP to verify and connect mobile number to user profile
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {String} contact_value Mobile number to verify
 * @apiBody {String} clientId Client identifier for session management
 *
 * @apiParamExample {json} Request-Example:
 *     {
 *       "contact_value": "+919876543210",
 *       "clientId": "web_12345"
 *     }
 *
 * @apiSuccess {String} message Success message
 *
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "message": "OTP sent successfully"
 *     }
 *
 * @apiError Unauthorized Invalid or missing JWT token
 * @apiError BadRequest Invalid mobile number or rate limit exceeded
 *
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "message": "Invalid mobile number. Please check and try again."
 *     }
 */
exports.sendOTPToConnectMobileToProfile = async function (req, res) {
    try {
        const userId = req.user.userId;
        const clientId = req.validatedBody.clientId;
        const contactValue = req.validatedBody.contact_value;

        // Validate and normalize mobile number with default country
            const mobile = googlePhoneNumberValidator.normalizeSinglePhoneNumber(contactValue);
        if (!mobile) {
            return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
                message: req.t('user:INVALID_MOBILE_NUMBER')
            });
        }

        // Check if resend timer exists
        const resendTimerExists = await RedisLoginOTPModel.getTimerForMobileConnectionOTP(mobile, clientId);
        if (resendTimerExists) {
            return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
                message: req.t('user:OTP_SEND_BLOCKED')
            });
        }

            const newOTP = generateOTP();
            const hashedOTP = await generateBcryptHash(newOTP);

        // Store OTP data
        await RedisLoginOTPModel.storeMobileConnectionOTP(mobile, clientId, {
                OTP: hashedOTP,
            contactType: 'mobile',
            contactValue: mobile,
            type: 'mobile_connection',
            userId: userId
        });

        // Set resend timer
        await RedisLoginOTPModel.setTimerForMobileConnectionOTP(mobile, clientId);

        // Send OTP via SMS
                const smsVariables = {
                    OTP: newOTP,
                };
        await sendSignupOTPTextSms(mobile, smsVariables);

        return res.status(HTTP_STATUS_CODES.OK).json({
            message: req.t('user:OTP_SENT_SUCCESSFULLY')
        });

    } catch (error) {
        logger.error('Error sending OTP:', { error: error.message, stack: error.stack });
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
            message: req.t('user:ERROR_WHILE_SENDING_OTP')
        });
    }
};

/**
 * @api {post} /profile/mobile/otp/verify Verify OTP to connect mobile number
 * @apiVersion 1.0.0
 * @apiName VerifyOTPToConnectMobile
 * @apiGroup Profile
 * @apiPermission JWT
 *
 * @apiDescription Verify OTP and connect mobile number to user profile
 *
 * @apiHeader {String} Authorization JWT token
 *
 * @apiBody {String} contact_value Mobile number being verified
 * @apiBody {String} clientId Client identifier for session management
 * @apiBody {String} otp OTP received via SMS
 *
 * @apiParamExample {json} Request-Example:
 *     {
 *       "contact_value": "+919876543210",
 *       "clientId": "web_12345",
 *       "otp": "1234"
 *     }
 *
 * @apiSuccess {String} message Success message
 *
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "message": "Mobile number connected successfully"
 *     }
 *
 * @apiError Unauthorized Invalid or missing JWT token
 * @apiError BadRequest Invalid OTP or mobile number
 *
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 400 Bad Request
 *     {
 *       "message": "Invalid OTP or contact info"
 *     }
 */

exports.verifyOTPToConnectMobileToProfile = async function (req, res) {
    try {
        const payload = req.validatedBody;
        const contactValue = payload.contact_value;
        const clientId = payload.clientId;
        const userId = req.user.userId;

        // Validate and normalize mobile number with default country
        const finalContactValue = googlePhoneNumberValidator.normalizeSinglePhoneNumber(contactValue);
        if (!finalContactValue) {
                return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
                message: req.t('user:INVALID_MOBILE_NUMBER')
            });
        }
        
        const matchedRedisOTPData = await RedisLoginOTPModel.getMobileConnectionOTP(finalContactValue, clientId);

        if (!matchedRedisOTPData) {
            return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
                message: req.t('user:OTP_NOT_FOUND_OR_EXPIRED')
            });
        }

        // Verify OTP matches and belongs to correct user
        const comparisonResult = await compareBcryptHash(payload.otp, matchedRedisOTPData.OTP);
        if (!comparisonResult || matchedRedisOTPData.userId !== userId) {
            return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
                message: req.t('user:INVALID_OTP_OR_CONTACT_INFO')
            });
        }

        // Update user's mobile number in database
        await UserModel.updateUserMobile(userId, finalContactValue);

        // Delete OTP after successful verification
        await RedisLoginOTPModel.deleteMobileConnectionOTP(finalContactValue, clientId);

        // Publish mobile verification event
        await kafkaCtrl.sendMessage(
            TOPICS.USER_EVENT_MOBILE_VERIFIED,
            [{
                value: {
                    userId,
                    verifiedAt: new Date()
                }
            }],
            'mobile_verified'
        );

        return res.status(HTTP_STATUS_CODES.OK).json({
            message: req.t('user:MOBILE_CONNECTED_SUCCESSFULLY')
        });

    } catch (error) {
        logger.error('Error verifying OTP:', { error: error.message, stack: error.stack });
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
            message: req.t('user:ERROR_WHILE_VERIFYING_OTP')
        });
    }
};

const sendSignupOTPTextSms = async (mobile, smsVariables) => {

    return await SMSCtrl.sendSignupSmsOTP(mobile, smsVariables);
}

function generateOTP() {
    var newId = new ShortUniqueId({ 
        length: 4,
        dictionary: 'number' 
    });

    return newId();
}

async function generateBcryptHash(str) {
    try {
        const saltRounds = 10;
        const hash = await bcrypt.hash(str, saltRounds);

        return hash;
    } catch (err) {
        throw err; // Rethrowing the error to be handled by the caller
    }
}

async function compareBcryptHash(str, hash) {
    try {
        const isMatched = await bcrypt.compare(str, hash);

        return isMatched;
    } catch (err) {
        throw err; // Rethrowing the error to be handled by the caller
    }
}
