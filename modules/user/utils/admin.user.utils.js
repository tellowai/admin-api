const cuid = require('cuid');


exports.changeAdminuserDataIntoDbSchema = function (newAdminUser, roleIds) {
  let memberWithRolesArray = [];

  memberWithRolesArray = newAdminUser.roles.map(role => {
    const matchingRole = roleIds.find(roleIdObj => roleIdObj.role_name === role);

    return {
      admin_user_role_id: cuid(),
      role_id: matchingRole ? matchingRole.role_id : role,
      user_id: newAdminUser.user_id
    };
  });

  return memberWithRolesArray;
}