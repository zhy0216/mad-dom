import { Window } from "mad-dom";

const window = new Window({
   enableJavaScriptEvaluation: true,
   settings: {
      module: {
         resolveNodeModules: {
            url: '/my-unique-path-for-node-modules/',
            directory: './node_modules'
         }
      }
   }
});

const document = window.document;
const script = document.createElement('script');

script.type = "module";
script.textContent = `import "path-to-package";`;

// The module specified in the "package.json" file for the package "path-to-package" will now be loaded from the "node_modules" directory
document.body.appendChild(script);
