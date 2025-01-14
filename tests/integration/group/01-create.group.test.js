const chai = require('chai');
const expect = chai.expect;
const supertest = require('supertest');
const app = require('../../../server');
const sharePreferences = require('../shared-preferences.manager.test');
let accessToken, user1Profile, user2Profile, user3Profile;


describe('Create Group API', () => {

  before(async function() {
    accessToken = await sharePreferences.getToken1();
    user1Profile = await sharePreferences.getUser1Profile();
    user2Profile = await sharePreferences.getUser2Profile();
    user3Profile = await sharePreferences.getUser3Profile();
  });

  it('should fail to create group and send unauthorized status', async () => {
    const response = await createGroup({
        group_name: "Test Group",
        group_description: "This is a test group.",
        group_profile_pic: "http://example.com/profile-pic.png",
        group_privacy: "public",
        group_members: []
      }, false);

      expect(response.status).to.equal(401);
  });

  it('should fail to create a group if group name exceeds more than 255 characters', async () => {
    const response = await createGroup({
        group_name: "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890"
      });

    expect(response.status).to.equal(400);
  });

  it('should fail to create a new group if group description exceeds more than 999 characters', async () => {
    const response = await createGroup({
        group_description: "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890" +
        "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890" +
        "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890" +
        "1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890"
      });

    expect(response.status).to.equal(400);
  });

  it('should fail to create a group without a name', async () => {
    const response = await createGroup({});

    expect(response.status).to.equal(400);
  });

  it('should fail to create a group with an invalid profile pic URL', async () => {
    const response = await createGroup({
        group_name: "Test Group 4",
        group_profile_pic: "not-a-valid-url"
      });

    expect(response.status).to.equal(400);
  });

  it('should fail to create a group with an invalid privacy value', async () => {
    const response = await createGroup({
        group_name: "Test Group 5",
        group_privacy: "not-valid"
      });

    expect(response.status).to.equal(400);
  });

  it('should fail to create a group with n valid privacy value - public', async () => {
    const response = await createGroup({
        group_name: "Test Group 6",
        group_privacy: "public"
      });

    expect(response.status).to.equal(201);
  });

  it('should fail to create a group with n valid privacy value - private', async () => {
    const response = await createGroup({
        group_name: "Test Group 7",
        group_privacy: "private"
      });

    expect(response.status).to.equal(201);
  });

  it('should fail to create a group with a number as the group_name', async () => {
    const response = await createGroup({
        group_name: 123456
      });

    expect(response.status).to.equal(400);
  });

  it('should fail to create a group if members array is with empty object', async () => {
    const response = await createGroup({
        group_name: "Test Group 8",
        group_members: [{}]
      });

    expect(response.status).to.equal(400);
  });

  it('should fail to create a group if member data is invalid. member_role is enum, either admin or member', async () => {
    const response = await createGroup({
        group_name: "Test Group 9",
        group_members: [{
          user_id: "1234",
          member_role: "1234"
        }]
      });

    expect(response.status).to.equal(400);
  });

  it('should fail when trying to add more than 50 members', async () => {
      const members = new Array(51).fill().map((_, idx) => `member${idx}`);
      const response = await createGroup({
          group_members: members
      });

      expect(response.status).to.equal(400);
  });  

  it('should succeed in creating a group with all fields', async () => {
    const inputPayload = {
      group_name: "Test Group",
      group_description: "This is a test group.",
      group_profile_pic: "http://example.com/profile-pic.png",
      group_privacy: "public",
      group_members: [user2Profile.user_id, user3Profile.user_id]
    };
    const response = await createGroup(inputPayload);

    if(response.body && response.body.group_id) {
      sharePreferences.setGroup1Data(response.body);
    }

    expect(response.status).to.equal(201);
    expect(response.body).to.be.an('object');
    expect(response.body).to.not.be.an('array');
    expect(response.body).to.not.be.an('array');
    expect(response.body).to.have.property('group_id');
    expect(response.body).to.have.property('group_name');
    expect(response.body.group_name).to.equal(inputPayload.group_name);
  });

  it('should succeed in creating a group with only the required fields', async () => {
    const response = await createGroup({
        group_name: "Test Group 2"
      });

    expect(response.status).to.equal(201);
  });
  
  it('should succeed in creating a group with default privacy setting', async () => {
    const response = await createGroup({
        group_name: "Test Group 3"
      });

    if(response.body && response.body.group_id) {
      sharePreferences.setGroup2Data(response.body);
    }

    expect(response.status).to.equal(201);
    // Assuming your response body contains the group data:
    // expect(response.body.group_privacy).to.equal('public');
  });

  it('should succeed in creating a group even with an unsupported fields, if all other supported field values are valid', async () => {
    const response = await createGroup({
        group_name: "Test Group 6",
        unsupported_field: "Some value"
      });

    expect(response.status).to.equal(201);
  });

  it('should succeed in creating a group if members array is empty', async () => {
    const response = await createGroup({
        group_name: "Test Group 7",
        group_members: []
      });

    expect(response.status).to.equal(201);
  });

  it('should succeed in creating a group if member data is valid', async () => {
    const response = await createGroup({
        group_name: "Test Group 11",
        group_members: ["GUEST1", user2Profile.user_id, "USER3"]
      });
      
    expect(response.status).to.equal(201);
    expect(response.body).to.have.property('group_members');
    expect(response.body.group_members).to.be.an('array');
  });
});

// Helper function to create a group
async function createGroup(payload, withToken = true) {
  let request = supertest(app).post('/groups');

  if (withToken) {
      request = request.set('Authorization', `Bearer ${accessToken}`);
  }

  return await request.send(payload);
}
