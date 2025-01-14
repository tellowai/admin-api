const { TOPICS } = require('../constants/kafka.events.config');
const kafkaCtrl = require('./kafka.controller');


exports.sendEmailWithTemplateName = async function(email, subject, emailVariables, templateName) {
    const data = {
        from: config.email.fromName + config.email.fromEmail,
        to: [email],
        subject: subject,
        template: templateName,
        'h:X-Mailgun-Variables': JSON.stringify(emailVariables)
    };

    kafkaCtrl.sendMessage(
        TOPICS.NOTIFICATION_EVENT_WELCOME_EMAIL,
        [{
          value: {
            template: templateName,
            subject
          }
        }],
        'welcome_email_sent'
    );


    return await mg.messages().send(data);
}
