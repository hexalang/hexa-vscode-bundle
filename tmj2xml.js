const fs = require('fs')

const json = JSON.parse(fs.readFileSync('syntaxes\\hexa.tmLanguage.json').toString())

function toXml(json, tabs) {
	if (json instanceof Array) {
		const result = [`<array>`]
		for (const value of json) {
			result.push(tabs + '\t' + toXml(value, tabs + '\t'))
		}
		result.push(`${tabs}</array>`)
		return result.join('\n')
	}

	if (json instanceof Object) {
		const result = [`<dict>`]
		for (const value of Reflect.ownKeys(json)) {
			result.push(tabs + '\t' + `<key>${value}</key>`)
			result.push(tabs + '\t' + toXml(json[value], tabs + '\t'))
		}
		result.push(`${tabs}</dict>`)
		return result.join('\n')
	}

	if (json instanceof String || typeof(json) == "string") {
		return `<string>${
			json
			.split('&lt;').join('@__preserve_lt@')
			.split('&gt;').join('@__preserve_gt@')
			.split('&amp;').join('@__preserve_amp@')
			.split('&').join('&amp;')
			.split('@__preserve_lt@').join('&lt;')
			.split('@__preserve_gt@').join('&gt;')
			.split('@__preserve_amp@').join('&amp;')
			.split('<').join('&lt;')
			.split('>').join('&gt;')
		}</string>`
	}

	return '?????????????????????????????????????????'
}

const output =
	`
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>fileTypes</key>
	<array>
		<string>${json.scopeName.split('.')[1]}</string>
	</array>
	<key>scopeName</key>
	<string>${json.scopeName}</string>
	<key>uuid</key>
	<string>${json.uuid}</string>
	<key>name</key>
	<string>${json.name}</string>
	<key>patterns</key>
	${toXml(json.patterns,'\t')}
	<key>repository</key>
	${toXml(json.repository,'\t')}
</dict>
</plist>
`

fs.writeFileSync('Hexa.tmLanguage', output.trim() + '\n')
