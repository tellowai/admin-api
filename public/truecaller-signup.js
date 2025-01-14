let requestId = localStorage.getItem('requestId') || generateUniquerequestId();

// Function to generate a unique ID (simple example)
function generateUniquerequestId() {
    let newId = Date.now().toString(36) + Math.random().toString(36).substr(2);;
    localStorage.setItem('requestId', newId);

    return newId;
}

function getAPIUrl() {
    const currentUrl = window.location.href;

    // Define the substring you want to check for
    const substring = 'localhost';

    // Check if the substring exists in the URL
    const substringExists = currentUrl.includes(substring);

    let apiUrl = 'http://localhost:1234';

    // Optionally, you can perform additional actions based on the result
    if (!substringExists) {
        apiUrl = 'https://dev.api.dialogueapp.club';
    }

    return apiUrl;
}

function openTruecallerAppForLogin() {
    window.location = "truecallersdk://truesdk/web_verify?" +
        "type=btmsheet" +
        "&requestNonce="+ requestId + // A unique request ID
        "&partnerKey=disbk3064d4cb7b53469da6ac289ec7535a57" +  // Your Truecaller app key
        "&partnerName=DialogApp" +  // Your app name
        "&lang=en" +  // Language locale (e.g., 'en' for English)
        "&privacyUrl=https://myapp.com/privacy" +  // URL to your privacy policy
        "&termsUrl=https://myapp.com/terms" +  // URL to your terms of service
        "&loginPrefix=Sign in with" +  // Title string prefix
        "&loginSuffix=for a seamless experience" +  // Title string suffix
        "&ctaPrefix=Continue with" +  // Button text prefix
        "&ctaColor=#3489db" +  // Button fill color (hex code)
        "&ctaTextColor=#ffffff" +  // Button text color (hex code)
        "&btnShape=round" +  // Button shape
        "&skipOption=Skip this step" +  // Footer CTA string
        "&ttl=60000"; // Time in milliseconds (e.g., 60 seconds)



    setTimeout(function() {

        if( document.hasFocus() ){
            alert('no truecaller')
            // Truecaller app not present on the device and you redirect the user 
            // to your alternate verification page
        } else{
            console.log('opening truecaller app')
            // Truecaller app present on the device and the profile overlay opens
            // The user clicks on verify & you'll receive the user's access token to fetch the profile on your 
            // callback URL - post which, you can refresh the session at your frontend and complete the user  verification
        }
    }, 600);
}

document.getElementById('truecallerLoginBtn').addEventListener('click', function(event) {
    event.stopPropagation();
    openTruecallerAppForLogin();
});
