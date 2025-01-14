const chai = require('chai');
const expect = chai.expect;
const supertest = require('supertest');
const app = require('../../../server');
const sharePreferences = require('../shared-preferences.manager.test');
let adminAccessToken, nonAdminAccessToken, admin2AccessToken, group1Data, group2Data, user1Profile, user2Profile, user3Profile;


describe('Add Members to Group API', () => {

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

    it('should fail to add members when not authorized', async () => {
        const response = await addMembersToGroup({
            group_members: ["user1", "user2"]
        }, group1Data.group_id);

        expect(response.status).to.equal(401);
    });

    it('should fail if one or more members have string length exceeding 255 characters', async () => {
        const longString = new Array(257).join('a'); // 257 characters long
        const response = await addMembersToGroup({
            group_members: [longString]
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(400);
    });

    it('should fail if group_members is not an array', async () => {
        const response = await addMembersToGroup({
            group_members: "user1"
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(400);
    });

    it('should fail if group does not exist', async () => {
        const invalidGroupId = 'non_existent_group_id';
        const response = await addMembersToGroup({
            group_members: ["user1", "user2"]
        }, invalidGroupId, adminAccessToken);

        expect(response.status).to.equal(403);
    });

    it('should fail if requester is not an admin of the group', async () => {
        const response = await addMembersToGroup({
            group_members: ["user1", "user2"]
        }, group2Data.group_id, nonAdminAccessToken);

        expect(response.status).to.equal(403);
    });

    it('should fail if requester is not part of the group', async () => {
        const response = await addMembersToGroup({
            group_members: ["user1", "user2"]
        }, group1Data.group_id, nonAdminAccessToken);

        expect(response.status).to.equal(403);
    });

    it('should fail when trying to add more than 50 members', async () => {
        const members = new Array(51).fill().map((_, idx) => `member${idx}`);
        const response = await addMembersToGroup({
            group_members: members
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(400);
    });    

    it('should successfully add members to the group', async () => {
        const response = await addMembersToGroup({
            group_members: ["user1", "user2", user2Profile.user_id, user3Profile.user_id]
        }, group2Data.group_id, adminAccessToken);

        expect(response.status).to.equal(201);
    });

    it('should successfully return response if group_members array is empty', async () => {
        const response = await addMembersToGroup({
            group_members: []
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(201);
    });
});

// Helper function to create a group
async function addMembersToGroup(payload, groupId, accessToken) {
    let request = supertest(app).post('/groups/' + groupId + '/members');

    if (accessToken) {
        request = request.set('Authorization', `Bearer ${accessToken}`);
    }

    return await request.send(payload);
}
