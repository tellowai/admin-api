const sharePreferences = require('./shared-preferences.manager.test');
const supertest = require('supertest');
const app = require('../../server');

before(async function () {
    try {
        const access_token1 = await loginUser1AndGetToken();
        sharePreferences.setToken1(access_token1);

        const access_token2 = await loginUser2AndGetToken();
        sharePreferences.setToken2(access_token2);

        const access_token3 = await loginUser3AndGetToken();
        sharePreferences.setToken3(access_token3);

        const user1_profile = await getUser1Profile(access_token1);
        sharePreferences.setUser1Profile(user1_profile);

        const user2_profile = await getUser2Profile(access_token2);
        sharePreferences.setUser2Profile(user2_profile);

        const user3_profile = await getUser3Profile(access_token3);
        sharePreferences.setUser3Profile(user3_profile);
    } catch (error) {
        console.error('Error login:', error);
    }
});

async function loginUser1AndGetToken() {
    // Replace the below with your test user credentials
    const userCredentials = {
        email: 'testuser1@yopmail.com',
        password: 'password'
    };

    try {
        const response = await supertest(app)
            .post('/auth/email')
            .send(userCredentials);

        if (response.status === 200 && response.body && response.body.accessToken) {
            return response.body.accessToken;
        } else {
            throw new Error('Failed to login and get token1', response);
        }
    } catch (error) {
        console.error('Error in loginAndGetToken1:', error.message);
        return error;
    }
}

async function loginUser2AndGetToken() {
    // Replace the below with your test user credentials
    const userCredentials = {
        email: 'usertest2@yopmail.com',
        password: 'password'
    };

    try {
        const response = await supertest(app)
            .post('/auth/email')
            .send(userCredentials);

        if (response.status === 200 && response.body && response.body.accessToken) {
            return response.body.accessToken;
        } else {
            throw new Error('Failed to login and get token2', response);
        }
    } catch (error) {
        console.error('Error in loginAndGetToken2:', error.message);
        return error;
    }
}

async function loginUser3AndGetToken() {
    // Replace the below with your test user credentials
    const userCredentials = {
        email: 'test3@yopmail.com',
        password: 'password'
    };

    try {
        const response = await supertest(app)
            .post('/auth/email')
            .send(userCredentials);

        if (response.status === 200 && response.body && response.body.accessToken) {
            return response.body.accessToken;
        } else {
            throw new Error('Failed to login and get token3', response);
        }
    } catch (error) {
        console.error('Error in loginAndGetToken3:', error.message);
        return error;
    }
}

async function getUser1Profile(accessToken) {
    try {
        const response = await supertest(app)
            .get('/me')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({});

        if (response.status === 200 && response.body && response.body.user_id) {
            return response.body;
        } else {
            throw new Error('Failed to get user 1 profile', response);
        }
    } catch (error) {
        console.error('Error in getting user 1 profile:', error.message);
        return error;
    }
}

async function getUser2Profile(accessToken) {
    try {
        const response = await supertest(app)
            .get('/me')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({});

        if (response.status === 200 && response.body && response.body.user_id) {
            return response.body;
        } else {
            throw new Error('Failed to get user 2 profile', response);
        }
    } catch (error) {
        console.error('Error in getting user 2 profile:', error.message);
        return error;
    }
}

async function getUser3Profile(accessToken) {
    try {
        const response = await supertest(app)
            .get('/me')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({});

        if (response.status === 200 && response.body && response.body.user_id) {
            return response.body;
        } else {
            throw new Error('Failed to get user 3 profile', response);
        }
    } catch (error) {
        console.error('Error in getting user 3 profile:', error.message);
        return error;
    }
}
