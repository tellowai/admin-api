const chai = require('chai');
const expect = chai.expect;
const supertest = require('supertest');
const app = require('../../../server');
const sharePreferences = require('../shared-preferences.manager.test');
let adminAccessToken, nonAdminAccessToken, admin2AccessToken, group1Data, group2Data, user1Profile, user2Profile, user3Profile;


describe('Remove Members from Group API', () => {

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

    // Test case for a member string exceeding 255 characters
    it('should fail when a member string exceeds 255 characters', async () => {
        const longMember = "a".repeat(256);
        const response = await removeMembersFromGroup({
            group_members: [longMember]
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(400);
    });

    // Test case for missing authorization (assuming only admins can remove members)
    it('should fail to remove members when unauthorized', async () => {
        const response = await removeMembersFromGroup({
            group_members: ["member1"]
        }, "validGroupId");

        expect(response.status).to.equal(401);
    });

    // Test case for forbidden access (assuming only admins can remove members)
    it('should fail to remove members when user is not an admin', async () => {
        const response = await removeMembersFromGroup({
            group_members: ["member1"]
        }, group1Data.group_id, nonAdminAccessToken);

        expect(response.status).to.equal(403);
    });

    // Test case for sending invalid payload (e.g., without group_members key)
    it('should fail when sending an invalid payload = object', async () => {
        const response = await removeMembersFromGroup({}, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(400);
    });

    // Test case for sending invalid payload (e.g., without group_members key)
    it('should fail when sending an invalid payload = string', async () => {
        const response = await removeMembersFromGroup("", group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(400);
    });

    it('should fail when trying to remove more than 50 members', async () => {
        const members = new Array(51).fill().map((_, idx) => `member${idx}`);
        const response = await removeMembersFromGroup({
            group_members: members
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(400);
    });   

    // Test case for valid removal of members
    it('should successfully remove members from a group', async () => {
        const response = await removeMembersFromGroup({
            group_members: [user2Profile.user_id]
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(201);
    });

    // Test case for trying to remove a non-existing member
    it('should be success when trying to remove a non-existing member', async () => {
        const response = await removeMembersFromGroup({
            group_members: ["nonExistingMember"]
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(201);
    });

    // Test case for invalid group ID
    it('should be success when the group ID is invalid', async () => {
        const response = await removeMembersFromGroup({
            group_members: ["member1"]
        }, "invalid-group-id", adminAccessToken);

        expect(response.status).to.equal(403);
    });

    // Test case for empty members array
    it('should be success when the members array is empty', async () => {
        const response = await removeMembersFromGroup({
            group_members: []
        }, group1Data.group_id, adminAccessToken);

        expect(response.status).to.equal(201);
    });
});

// Helper function to create a group
async function removeMembersFromGroup(payload, groupId, accessToken) {
    let request = supertest(app).delete('/groups/' + groupId + '/members');

    if (accessToken) {
        request = request.set('Authorization', `Bearer ${accessToken}`);
    }

    return await request.send(payload);
}
