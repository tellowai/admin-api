exports.combineTwoArraysReturnUniqueArr = function (arr1, arr2) {

  // Combine the arrays using the spread operator
  let combinedArr = [...arr1, ...arr2];

  // Generate unique IDs
  let finalArr = new Set(combinedArr);

  // Convert Set back to an array
  finalArr = Array.from(finalArr);

  return finalArr;
}

exports.getMediaTypeFromUrl = function (url) {
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp"];
  const videoExtensions = [".mp4", ".avi", ".mov", ".wmv", ".mkv"];

  const urlLowercase = url.toLowerCase();
  if (imageExtensions.some(ext => urlLowercase.endsWith(ext))) {
    return "image";
  } else if (videoExtensions.some(ext => urlLowercase.endsWith(ext))) {
    return "video";
  } else {
    return "image"; // Default to "image" if the extension is not recognized
  }
}

exports.sortArr1DataByArr2 = function(arr1, arr2, key) {
 // use created_at from adminUserIdsWithFullObj and sort the final data based on that
 arr1.forEach(itemA2 => {
  // Find the corresponding element in a1
  const itemA1 = arr2.find(itemA1 => itemA1[key] === itemA2[key]);
  
  // If found, add the 'created_at' value from a1 to a2 as 'admin_created_at'
  if (itemA1) {
    itemA2.admin_created_at = itemA1.created_at;
  }
});

arr1.sort((a, b) => {
  // Convert dates to JavaScript Date objects for comparison
  let dateA = new Date(a.admin_created_at);
  let dateB = new Date(b.admin_created_at);

  // Compare the dates
  return dateB - dateA; // For ascending order
  // Use `return dateB - dateA` for descending order
});

return arr1;
}
