const fs = require("fs");
const path = require("path");

function main() {
  const moduleName = process.argv[2];
  
  if (!moduleName) {
    console.error("Please provide a module name. Usage: npm run create-module <module_name>");
    process.exit(1);
  }

  const baseDir = path.join(process.cwd(), "modules", moduleName);
  const structure = getModuleStructure(moduleName);

  createModuleStructure(moduleName, baseDir, structure);

  console.log(`Module "${moduleName}" created successfully in ${baseDir}`);
}

// Create module directories and files
function createModuleStructure(moduleName, baseDir, structure) {
  structure.forEach(({ folder, fileSuffix, content }) => {
    const folderPath = path.join(baseDir, folder);
    fs.mkdirSync(folderPath, { recursive: true });

    // Create the file inside the folder
    const fileName = `${moduleName}.${fileSuffix}.js`;
    const filePath = path.join(folderPath, fileName);

    fs.writeFileSync(filePath, content.trim());
  });
}

function getModuleStructure(moduleName) {
  return [
    {
      folder: "controllers",
      fileSuffix: "controller",
      content: `
exports.${moduleName}Controller = (req, res) => {
  // Implement ranking logic here
};
`,
    },
    {
      folder: "middlewares",
      fileSuffix: "middleware",
      content: `
exports.${moduleName}Middleware = () => {
  // Implement middleware logic here
};
`,
    },
    {
      folder: "models",
      fileSuffix: "model",
      content: `
exports.${moduleName}Model = () => {
  // Implement model logic here
};
`,
    },
    {
      folder: "routes",
      fileSuffix: "route",
      content: `
module.exports = (app) => {
  app.route().get();
};
`,
    },
    {
      folder: "validators",
      fileSuffix: "validator",
      content: `
exports.${moduleName}Validator = (data) => {
  // Add validation logic for ${moduleName}
  return true;
};
`,
    },
  ];  
}

main();