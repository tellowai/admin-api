function callBackendAPI(data) {
    console.log(data,'data');
    // Get the current URL
    const currentUrl = window.location.href;

    // Define the substring you want to check for
    const substring = 'localhost';

    // Check if the substring exists in the URL
    const substringExists = currentUrl.includes(substring);

    // Log the result
    console.log(`Does the substring "${substring}" exist in the URL?`, substringExists);
    let apiUrl = 'http://localhost:8000/auth/google';

    // Optionally, you can perform additional actions based on the result
    if (!substringExists) {
        apiUrl = 'https://dev-api.photobop.co/auth/google';
    }

    // Make the POST request
    fetch(apiUrl, {
        method: 'POST', // Specify the method
        headers: {
            'Content-Type': 'application/json' // Specify the content type
        },
        body: JSON.stringify({
        credential: data.credential
        }) // Convert the payload to a JSON string
    })
    .then(response => response.json()) // Convert the response to JSON
    .then(data => {
        console.log('Success:', data); // Handle the success case
    })
    .catch((error) => {
        console.error('Error:', error); // Handle the error case
    });
}