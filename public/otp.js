var configuration = {
    widgetId: "346466717066373131333732",
    tokenAuth: "419611TCAjfj6Xum66216350P1",
    identifier: "+919705053031",
    exposeMethods: "true",  // When true will expose the methods for OTP verification. Refer 'How it works?' for more details
    success: (data) => {
        // get verified token in response
        console.log('success response', data);
    },
    failure: (error) => {
        // handle error
        console.log('failure reason', error);
    },
};

document.addEventListener('DOMContentLoaded', function() {
    window.initSendOTP(configuration);
});
