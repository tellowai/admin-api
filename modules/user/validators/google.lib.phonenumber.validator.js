const googleLibPhoneNumber = require('google-libphonenumber');
const phoneUtil = googleLibPhoneNumber.PhoneNumberUtil.getInstance();
var config = require('../../../config/config');
const number = require('@hapi/joi/lib/types/number');


exports.normalizePhoneNumbers = function(contacts) {
    // const contacts = [
    //     { name: "Alice", number: "+1 415 555 2671" },
    //     { name: "Bob", number: "4081234567" },
    //     { name: "Charlie", number: "+442071838750" },
    //     { name: "David", number: "0733312345" },
    //     { name: "Eve", number: "+919876543210" },
    //     { name: "Frank", number: "+91 8765432109" },
    //     { name: "Grace", number: "+91 765 432 1098" },
    //     { name: "Henry", number: "+91 65432 10987" },
    //     { name: "Ivy", number: "+44 208 123 4567" },
    //     { name: "Jack", number: "+49 30 12345678" },
    //     { name: "Kate", number: "+33 1 23 45 67 89" },
    //     { name: "Liam", number: "+61 2 3456 7890" },
    // ];

    const defaultCountryCode = config.contacts.defaultCountryCode;

    // Arrays to hold valid and invalid contacts
    let validContacts = [];
    let invalidContacts = [];
    let allNormalizedContacts = {
        validContacts,
        invalidContacts
    }

    contacts.forEach(contact => {
        try {
            let countryCode = contact.number.startsWith('+') ? defaultCountryCode : inferCountryCode(contact);
            let phoneNumber = phoneUtil.parseAndKeepRawInput(contact.number, countryCode);
            if (phoneUtil.isValidNumber(phoneNumber)) {
                contact.formattedNumber = phoneUtil.format(phoneNumber, googleLibPhoneNumber.PhoneNumberFormat.E164);
                validContacts.push(contact);
            } else {
                contact.reason = 'Failed libphonenumber validation';
                invalidContacts.push(contact);
            }
        } catch (error) {
            contact.reason = error.toString();
            invalidContacts.push(contact);
        }
    });

    return allNormalizedContacts;
}

exports.normalizeSinglePhoneNumber = function(contact) {
    const defaultCountryCode = config.contacts.defaultCountryCode;
    let validPhoneNumber = null;

    try {
        let countryCode = contact.startsWith('+') ? defaultCountryCode : inferCountryCode(contact);
        let phoneNumber = phoneUtil.parseAndKeepRawInput(contact, countryCode);

        if (phoneUtil.isValidNumber(phoneNumber)) {
            const formattedNumber = phoneUtil.format(phoneNumber, googleLibPhoneNumber.PhoneNumberFormat.E164);
            validPhoneNumber = formattedNumber;
        } else {
            const reason = 'Failed libphonenumber validation';
        }
    } catch (error) {
        console.log(error,'error inside')
        const reason = error.toString();
    }

    return validPhoneNumber;
}

function inferCountryCode(contact) {
    // Placeholder function - implement your logic here based on additional data you might have
    // This could involve looking up a database, checking user settings, etc.
    return config.contacts.defaultCountryCode;
}
