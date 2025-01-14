const chai = require('chai');
const expect = chai.expect;
const supertest = require('supertest');
const app = require('../../../server');
const sharePreferences = require('../shared-preferences.manager.test');
let adminAccessToken, nonAdminAccessToken, admin2AccessToken, group1Data, group2Data, user1Profile, user2Profile, user3Profile;


describe('Update Group Metadata API', () => {

    before(async function() {
        adminAccessToken = await sharePreferences.getToken1();
        nonAdminAccessToken = await sharePreferences.getToken2();
        admin2AccessToken = await sharePreferences.getToken3();
        user1Profile = await sharePreferences.getUser1Profile();
        user2Profile = await sharePreferences.getUser2Profile();
        user3Profile = await sharePreferences.getUser3Profile();
        group1Data = await sharePreferences.getGroup1Data();
        group2Data = await sharePreferences.getGroup2Data();
    });

    it('should fail if a non-admin user tries to update group metadata', async () => {
        const response = await updateGroup({ group_name: "New Name" }, group1Data.group_id, nonAdminAccessToken);
        expect(response.status).to.equal(403);
    });

    it('should fail if a user who is not part of group tries to update group metadata', async () => {
        const response = await updateGroup({ group_name: "New Name" }, group2Data.group_id, nonAdminAccessToken);
        expect(response.status).to.equal(403);
    });

    it('should fail to update with a group_name longer than 255 characters', async () => {
        const longName = "a".repeat(256);
        const response = await updateGroup({ group_name: longName }, group1Data.group_id, adminAccessToken);
        expect(response.status).to.equal(400);
    });

    it('should fail to update with a group_description longer than 999 characters', async () => {
        const longDescription = "a".repeat(1000);
        const response = await updateGroup({ group_description: longDescription }, group1Data.group_id, adminAccessToken);
        expect(response.status).to.equal(400);
    });

    it('should fail to update with an invalid group_cover_pic URL', async () => {
        const response = await updateGroup({ group_cover_pic: "invalidURL" }, group1Data.group_id, adminAccessToken);
        expect(response.status).to.equal(400);
    });

    it('should fail to update with an invalid group_privacy value', async () => {
        const response = await updateGroup({ group_privacy: "unknown" }, group1Data.group_id, adminAccessToken);
        expect(response.status).to.equal(400);
    });

    it('should successfully change role of a group member', async () => {
        const response = await changeGroupMemberRole({ 
            member_role:  'admin'
        }, group1Data.group_id, user3Profile.user_id, adminAccessToken);

        expect(response.status).to.equal(200);
    });

    it('should successfully update the group name if the other admin changes group meta data', async () => {
        const newGroupName = "New Name";
        const response = await updateGroup({ group_name:  newGroupName}, group1Data.group_id, admin2AccessToken);
        expect(response.status).to.equal(200);
        expect(response.body.group_name).to.equal(newGroupName);
    });

    it('should successfully update the group name', async () => {
        const newGroupName = "New Name";
        const response = await updateGroup({ group_name:  newGroupName}, group1Data.group_id, adminAccessToken);
        expect(response.status).to.equal(200);
        expect(response.body.group_name).to.equal(newGroupName);
    });

    it('should successfully update the group description', async () => {
        const newGroupDescription =  "New Description";
        const response = await updateGroup({ group_description: newGroupDescription}, group1Data.group_id, adminAccessToken);
        expect(response.status).to.equal(200);
        expect(response.body.group_description).to.equal(newGroupDescription);
    });

    it('should successfully update the group meta data even with unsupported fields as long as all supported fileds data is valid', async () => {
        const newGroupName = "New Name";
        const newGroupDescription =  "New Description";
        const response = await updateGroup({ 
            group_name:  newGroupName,
            group_description: newGroupDescription,
            group_unkown_key: 1234,
            not_supported_key: 'newGroupDescription'
        }, group1Data.group_id, adminAccessToken);
        expect(response.status).to.equal(200);
        expect(response.body.group_description).to.equal(newGroupDescription);
        expect(response.body.group_name).to.equal(newGroupName);
    });

    it('should successfully update the group privacy to public', async () => {
      const response = await updateGroup({
          group_privacy: "public"
        }, group1Data.group_id, adminAccessToken);
  
      expect(response.status).to.equal(200);
      expect(response.body.group_privacy).to.equal('public');
    });
  
    it('should successfully update the group privacy to private', async () => {
      const response = await updateGroup({
          group_privacy: "private"
        }, group1Data.group_id, adminAccessToken);
  
      expect(response.status).to.equal(200);
      expect(response.body.group_privacy).to.equal('private');
    });
});

// Helper function to create a group
async function updateGroup(payload, groupId, accessToken) {
  let request = supertest(app).patch('/groups/'+groupId);

  if (accessToken) {
      request = request.set('Authorization', `Bearer ${accessToken}`);
  }

  return await request.send(payload);
}

// Helper function to change role of a member
async function changeGroupMemberRole(payload, groupId, memberId, accessToken) {
    let request = supertest(app).patch('/groups/'+groupId+'/members/'+memberId);
  
    if (accessToken) {
        request = request.set('Authorization', `Bearer ${accessToken}`);
    }
  
    return await request.send(payload);
  }
