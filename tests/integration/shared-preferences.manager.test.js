let token1, token2, token3;
let group1Data, group2Data, group3Data = {};
let user1Profile, user2Profile, user3Profile = {};

module.exports = {
    setToken1: function(newToken) {
        token1 = newToken;
    },
    getToken1: function() {
        return token1;
    },
    setToken2: function(newToken) {
        token2 = newToken;
    },
    getToken2: function() {
        return token2;
    },
    setToken3: function(newToken) {
        token3 = newToken;
    },
    getToken3: function() {
        return token3;
    },
    setGroup1Data: function(groupData) {
        group1Data = groupData;
    },
    getGroup1Data: function() {
        return group1Data;
    },
    setGroup2Data: function(groupData) {
        group2Data = groupData;
    },
    getGroup2Data: function() {
        return group2Data;
    },
    setGroup3Data: function(groupData) {
        group3Data = groupData;
    },
    getGroup3Data: function() {
        return group3Data;
    },
    setUser1Profile: function(profile) {
        user1Profile = profile;
    },
    getUser1Profile: function() {
        return (user1Profile.user_id)? user1Profile : null;
    },
    setUser2Profile: function(profile) {
        user2Profile = profile;
    },
    getUser2Profile: function() {
        return (user2Profile.user_id)? user2Profile : null;
    },
    setUser3Profile: function(profile) {
        user3Profile = profile;
    },
    getUser3Profile: function() {
        return (user3Profile.user_id)? user3Profile : null;
    }
};
