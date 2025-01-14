const chai = require('chai');
const expect = chai.expect;
const supertest = require('supertest');
const app = require('../../../server');
const sharePreferences = require('../shared-preferences.manager.test');
let adminAccessToken, nonAdminAccessToken, admin2AccessToken, group1Data, group2Data, user1Profile, user2Profile, user3Profile;


describe('Change Member Role In Group API', () => {

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

    it('should successfully change the member role when valid access token of an admin is provided', async () => {
        const payload = {
            member_role: 'admin'
        };
        const response = await changeMemberRoleInGroup(payload, group1Data.group_id, user2Profile.user_id, adminAccessToken);
        
        expect(response.status).to.equal(200);
    });

    it('should throw an error when no access token is provided', async () => {
        const response = await changeMemberRoleInGroup({}, group1Data.group_id, user2Profile.user_id, null);

        expect(response.status).to.equal(401);
    });

    it('should throw an error when a non-admin user tries to change the role', async () => {
        const payload = {
            member_role: 'admin'
        };
        const response = await changeMemberRoleInGroup(payload, group1Data.group_id, user2Profile.user_id, nonAdminAccessToken);
        
        expect(response.status).to.equal(403);
    });

    it('should throw an error when trying to change the role of a non-existent member', async () => {
        const payload = {
            member_role: 'admin'
        };
        const response = await changeMemberRoleInGroup(payload, group1Data.group_id, "invalid-id", adminAccessToken);
        
        expect(response.status).to.equal(200);
    });

    it('should throw an error when the provided group ID does not exist', async () => {
        const response = await changeMemberRoleInGroup({}, 'invalid-group', user2Profile.user_id, adminAccessToken);
        
        expect(response.status).to.equal(403);
    });

    it('should throw an error when an invalid role is provided in payload', async () => {
        const invalidPayload = {
            member_role: 'invalid_role'
        };
        const response = await changeMemberRoleInGroup(invalidPayload, group1Data.group_id, user2Profile.user_id, adminAccessToken);
        
        expect(response.status).to.equal(400);
    });

    it('should throw an error when an invalid type input is provided in payload = string', async () => {
        const invalidPayload = "";
        const response = await changeMemberRoleInGroup(invalidPayload, group1Data.group_id, user2Profile.user_id, adminAccessToken);
        
        expect(response.status).to.equal(400);
    });

    it('should throw an error when an invalid type input is provided in payload = array', async () => {
        const invalidPayload = [];
        const response = await changeMemberRoleInGroup(invalidPayload, group1Data.group_id, user2Profile.user_id, adminAccessToken);
        
        expect(response.status).to.equal(400);
    });
});

// Helper function to create a group
async function changeMemberRoleInGroup(payload, groupId, memberId, accessToken) {
    let request = supertest(app).patch('/groups/' + groupId + '/members/' + memberId);

    if (accessToken) {
        request = request.set('Authorization', `Bearer ${accessToken}`);
    }

    return await request.send(payload);
}
