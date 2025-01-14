const chai = require('chai');
const expect = chai.expect;
const supertest = require('supertest');
const app = require('../../../server');
const sharePreferences = require('../shared-preferences.manager.test');
let adminAccessToken, nonAdminAccessToken, admin2AccessToken, group1Data, group2Data, user1Profile, user2Profile, user3Profile;


describe('Exit From Group API', () => {

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

    it('should successfully exit from the group when valid access token is provided', async () => {
        const response = await exitFromGroup({}, group1Data.group_id, adminAccessToken);
        
        expect(response.status).to.equal(204);
    });

    it('should throw an error when no access token is provided', async () => {
        const groupId = 'valid_group_id';
        const response = await exitFromGroup({}, groupId, null);
        
        expect(response.status).to.equal(401);
        // expect(response.body.message).to.equal('Unauthorized');
    });

    it('should throw an error when an invalid access token is provided', async () => {
        const invalidAccessToken = 'invalid_token';
        const response = await exitFromGroup({}, group1Data.group_id, invalidAccessToken);
        
        expect(response.status).to.equal(401);
        // expect(response.body.message).to.equal('Invalid token');
    });

    // it('should be successful when user is not part of the group', async () => {
    //     const response = await exitFromGroup({}, group1Data.group_id, adminAccessToken);
        
    //     expect(response.status).to.equal(200);
    // });

    it('should be successful when the provided group ID does not exist', async () => {
        const invalidGroupId = 'invalid_group_id';
        const response = await exitFromGroup({}, invalidGroupId, adminAccessToken);
        
        expect(response.status).to.equal(200);
    });

    it('should throw an error when user is the last admin of the group', async () => {
        const lastAdminGroupId = 'group_id_with_last_admin'; // replace with a group ID where the user is the last admin
        const response = await exitFromGroup({}, group2Data.group_id, adminAccessToken);
        
        expect(response.status).to.equal(403);
    });
});

// Helper function to create a group
async function exitFromGroup(payload, groupId, accessToken) {
    let request = supertest(app).delete('/groups/' + groupId + '/members/exit');

    if (accessToken) {
        request = request.set('Authorization', `Bearer ${accessToken}`);
    }

    return await request.send(payload);
}
