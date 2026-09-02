import { Window } from "mad-dom";

const window = new Window({ url: "https://localhost:3000" });

window.happyDOM.settings.navigation.userAgent =
	"Mozilla/5.0 (X11; Linux x64) AppleWebKit/537.36 (KHTML, like Gecko) HappyDOM/2.0.0";

await window.happyDOM.close();
