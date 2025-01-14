const config = require('../../../config/config');
const http = require("https");


exports.sendLoginSmsOTP = async function(mobile, smsVariables) {
    const templateId = config.sms.msg91.templates.loginTemplateId;
    const authKey = config.sms.msg91.authKey;

    const options = {
        method: "POST",
        hostname: "control.msg91.com",
        port: null,
        path: `/api/v5/otp?template_id=${templateId}&mobile=${mobile}&authkey=${authKey}`,
        headers: {
            "Content-Type": "application/json"
        }
    };

    const req = http.request(options, function (res) {
        const chunks = [];
        
        res.on("data", function (chunk) {
            chunks.push(chunk);
        });
        
        res.on("end", function () {
            const body = Buffer.concat(chunks);
            //console.log(body.toString());
        });
    });

    const postData = JSON.stringify({
        OTP: smsVariables.OTP
    });

    req.write(postData);
    req.end();
}

exports.sendSignupSmsOTP = async function(mobile, smsVariables) {
    const templateId = config.sms.msg91.templates.signupTemplateId;
    const authKey = config.sms.msg91.authKey;

    const options = {
        method: "POST",
        hostname: "control.msg91.com",
        port: null,
        path: `/api/v5/otp?template_id=${templateId}&mobile=${mobile}&authkey=${authKey}`,
        headers: {
            "Content-Type": "application/json"
        }
    };

    const req = http.request(options, function (res) {
        const chunks = [];
        
        res.on("data", function (chunk) {
            chunks.push(chunk);
        });
        
        res.on("end", function () {
            const body = Buffer.concat(chunks);
            //console.log(body.toString());
        });
    });

    const postData = JSON.stringify({
        OTP: smsVariables.OTP
    });


    req.write(postData);
    req.end();
}
