import { Window } from 'happy-dom';

const window = new Window({
	innerWidth: 1024,
	innerHeight: 768,
	url: 'http://localhost:8080',
	settings: { enableJavaScriptEvaluation: true }
});
const document = window.document;

document.write(`
    <html>
        <head>
             <title>Test page</title>
        </head>
        <body>
             <div class="container">
                  <!-- Content will be added here -->
             </div>
            <script>
                const element = document.createElement('div');
                const container = document.querySelector('.container');
                element.innerHTML = 'Test';
                container.appendChild(element);
            </script>
        </body>
    </html>
`);

// Will output "Test"
console.log(document.querySelector('.container div').innerHTML);
