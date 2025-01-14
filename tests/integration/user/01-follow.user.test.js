const chai = require('chai');
const expect = chai.expect;
const supertest = require('supertest');
const app = require('../../../server');
const sharePreferences = require('../shared-preferences.manager.test');
let adminAccessToken, nonAdminAccessToken, admin2AccessToken, group1Data, group2Data, user1Profile, user2Profile, user3Profile;

describe('Follow User API', () => {

    before(async function () {
        adminAccessToken = await sharePreferences.getToken1();
        nonAdminAccessToken = await sharePreferences.getToken2();
        admin2AccessToken = await sharePreferences.getToken3();
        user1Profile = await sharePreferences.getUser1Profile();
        user2Profile = await sharePreferences.getUser2Profile();
        user3Profile = await sharePreferences.getUser3Profile();
        group1Data = await sharePreferences.getGroup1Data();
        group2Data = await sharePreferences.getGroup2Data();
    });

    it('should successfully follow another user (user 2)', async () => {
        const response = await followUser(user2Profile.user_id, adminAccessToken);

        expect(response.status).to.equal(200);
    });

    it('should successfully follow another user (user 3)', async () => {
        const response = await followUser(user3Profile.user_id, adminAccessToken);

        expect(response.status).to.equal(200);
    });

    it('should not allow a user to follow themselves', async () => {
        const response = await followUser(user1Profile.user_id, adminAccessToken);

        expect(response.status).to.equal(400);
    });

    it('should not allow following the same user twice', async () => {
        await followUser(user2Profile.user_id, adminAccessToken);

        const response = await followUser(user2Profile.user_id, adminAccessToken);

        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('message', "You are following the user alrady.");
    });

    it('should handle non-existing users', async () => {
        const fakeUserId = 'nonExistingUserId';
        const response = await followUser(fakeUserId, adminAccessToken);

        expect(response.status).to.equal(404);
    });
});

// Helper function to follow a user
async function followUser(userId, accessToken) {
    let request = supertest(app).post('/users/' + userId + '/follow');

    if (accessToken) {
        request = request.set('Authorization', `Bearer ${accessToken}`);
    }

    return await request.send();
}
