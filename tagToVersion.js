const fs = require('fs')
const ref = process.argv.pop().trim()
const tag = ref.split('v').pop()
console.log({ref, tag })

function update(file, pattern) {
	const json = fs.readFileSync(file).toString()
	fs.writeFileSync(file, json.split(pattern).join(tag))
}

update('package.json', "0.2.1")
update('package-lock.json', "0.1.2")
