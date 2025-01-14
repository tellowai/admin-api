
function statusChangeCallback(response) {  // Called with the results from FB.getLoginStatus().
    console.log('statusChangeCallback');
    console.log(response);                   // The current login status of the person.
    
    if(response.authResponse && response.authResponse.accessToken) {
  
      let fbAccessToken = response.authResponse.accessToken;
      callBackend(fbAccessToken);
    }
  
    if (response.status === 'connected') {   // Logged into your webpage and Facebook.
      testAPI();  
    } else {                                 // Not logged into your webpage or we are unable to tell.
      document.getElementById('status').innerHTML = 'Please log ' +
        'into this webpage.';
    }
  }
  
  
  function checkLoginState() {               // Called when a person is finished with the Login Button.
    FB.getLoginStatus(function(response) {   // See the onlogin handler
      statusChangeCallback(response);
    });
  }
  
  
  window.fbAsyncInit = function() {
    FB.init({
      appId      : '1273922623026417',
      cookie     : true,                     // Enable cookies to allow the server to access the session.
      xfbml      : true,                     // Parse social plugins on this webpage.
      version    : 'v18.0'           // Use this Graph API version for this call.
    });
  
  
    FB.getLoginStatus(function(response) {   // Called after the JS SDK has been initialized.
      statusChangeCallback(response);        // Returns the login status.
    });
  };
  
  function testAPI() {                      // Testing Graph API after login.  See statusChangeCallback() for when this call is made.
    console.log('Welcome!  Fetching your information.... ');
    FB.api('/me', function(response) {
      console.log('Successful login for: ' + response.name);
      document.getElementById('status').innerHTML =
        'Thanks for logging in, ' + response.name + '!';
    });
  }
  
  function callBackend(fbAccessToken) {
    // Get the current URL
    const currentUrl = window.location.href;
  
    // Define the substring you want to check for
    const substring = 'localhost';
  
    // Check if the substring exists in the URL
    const substringExists = currentUrl.includes(substring);
  
    // Log the result
    console.log(`Does the substring "${substring}" exist in the URL?`, substringExists);
    let apiUrl = 'http://localhost:8000/auth/facebook';
  
    // Optionally, you can perform additional actions based on the result
    if (!substringExists) {
        apiUrl = 'https://dev-api.photobop.co/auth/facebook';
    }
  
    // Define the payload you want to send
    const payload = {
        access_token: fbAccessToken
    };
  
    // Make the POST request
    fetch(apiUrl, {
        method: 'POST', // Specify the method
        headers: {
            'Content-Type': 'application/json' // Specify the content type
        },
        body: JSON.stringify(payload) // Convert the payload to a JSON string
    })
    .then(response => response.json()) // Convert the response to JSON
    .then(data => {
        console.log('Success:', data); // Handle the success case
    })
    .catch((error) => {
        console.error('Error:', error); // Handle the error case
    });
  
  }