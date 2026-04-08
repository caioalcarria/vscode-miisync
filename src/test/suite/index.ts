import * as path from 'path';
import Mocha = require('mocha');
import { sync as globSync } from 'glob';

export function run(): Promise<void> {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise((c, e) => {
		try {
			const files = globSync('**/**.test.js', { cwd: testsRoot });
			files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));
			mocha.run(failures => {
				if (failures > 0) {
					e(new Error(`${failures} tests failed.`));
				} else {
					c();
				}
			});
		} catch (err) {
			console.error(err);
			e(err);
		}
	});
}
