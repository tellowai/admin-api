const chai = require('chai');
const expect = chai.expect;
const supertest = require('supertest');
const app = require('../../../server');
const sharePreferences = require('../shared-preferences.manager.test');
let adminAccessToken, nonAdminAccessToken, admin2AccessToken, group1Data, group2Data, user1Profile, user2Profile, user3Profile;

describe('Un-Follow User API', () => {
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

    it('should successfully un-follow another user', async () => {
        const response = await unFollowUser(user3Profile.user_id, adminAccessToken);
        expect(response.status).to.equal(200);
    });

    it('should not un-follow a user that you haven\'t followed', async () => {
        const response = await unFollowUser(user3Profile.user_id, adminAccessToken);
        expect(response.status).to.equal(200);
    });

    it('should not un-follow a non-existent user', async () => {
        const response = await unFollowUser('nonexistentUserId', adminAccessToken);
        expect(response.status).to.equal(200);
    });

    it('should not un-follow without an access token', async () => {
        const response = await unFollowUser(user2Profile.user_id);
        expect(response.status).to.equal(401);
    });

    it('should not un-follow with an invalid access token', async () => {
        const response = await unFollowUser(user2Profile.user_id, 'invalidAccessToken');
        expect(response.status).to.equal(401);
    });

    it('should not un-follow yourself', async () => {
        const response = await unFollowUser(adminAccessToken, adminAccessToken);
        expect(response.status).to.equal(200);
    });

});

// Helper function to follow a user
async function unFollowUser(userId, accessToken) {
    let request = supertest(app).delete('/users/' + userId + '/follow');

    if (accessToken) {
        request = request.set('Authorization', `Bearer ${accessToken}`);
    }

    return await request.send();
}
