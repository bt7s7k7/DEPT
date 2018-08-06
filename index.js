/*
 * DEPT - Data Extraction and Processing Tool
 * Copyright (C) 2018 Branislav Trstenský
 */

const B = require("bUtils")
const repl = require("repl")
const fs = require("fs")
const util = require("util")

var context
var history = []
var typeFileSeparator = "\n─────────────────────────────────────────\n"
var maxChars = 10000
function inspect(thing) {
	return util.inspect(thing, {colors: true}).substr(0, maxChars)
}

function Data(value = []) {
	this.value = value
}


Object.assign(Data.prototype, {
	print() {
		B.print(this.value)
		return this.copy()
	},
	copy() {
		return new Data(this.value.copy())
	},
	print() {
		B.log("\r" + inspect(this.value))
		return this
	},
	load() {
		history.push(context.data)
		context.data = this.copy()
		return context.data
	},
	split(delimiter) {
		return new Data(this.value.map(v => v.toString().split(delimiter)))
	},
	lines() {
		return this.split(/\r?\n/)
	},
	chars() {
		return this.split("")
	},
	flatten() {
		var ret = []
		this.value.forEach(v => typeof (v) == "string" || v instanceof Array ? ret.push(...v) : ret.push(...v.toString()))
		return new Data(ret)
	},
	type() {
		B.log("\r" + this.value.join(typeFileSeparator))
		return this
	},
	each() {
		return new MassData(this.value.map(v => new Data(v instanceof Array ? v : [v])))
	},
	splice(at, number = 1) {
		return new Data(this.value.copy.splice(at, number))
	},
	at(index) {
		return new Data([this.value[index]])
	},
	replace(...args) {
		return new Data(this.value.map(v => v.replace(...args)))
	},
	float() {
		return new Data(this.value.map(v => parseFloat(v.toString())))
	},
	offset(num) {
		return new Data(this.value.map(v => v + num))
	},
	map(func) {
		return new Data(this.value.map(func))
	},
	join(delim) {
		return new Data([this.join(delim)])
	},
	writeFile(path) {
		fs.writeFile(path, this.value.join("\u001f"), (err) => {
			if (err) return B.write("\r" + err.stack + "\n> ")
			B.write("\rFile " + path + " written\n> ")
		})
		return this
	},
	files() {
		context.files = this.copy()
		return this
	},
	write() {
		if (context.files) {
			if (context.files.value.length == this.value.length) {
				context.files.value.forEach((path, i) => {
					fs.writeFile(path, this.value[i], (err) => {
						if (err) return B.write("\r" + err.stack + "\n> ")
						B.write("\rFile " + path + " written\n> ")
					})
				})
			} else {
				throw new Error("Incorect amount of files registered (" + context.files.value.length + " != " + this.value.length + ")")
			}
		} else {
			throw new Error("No file names registered")
		}
		return this
	},
	rename() {
		if (context.files) {
			if (context.files.value.length == this.value.length) {
				context.files.value.forEach((path, i) => {
					fs.rename(path, this.value[i], (err) => {
						if (err) return B.write("\r" + err.stack + "\n> ")
						B.write("\rFile " + path + " renamed\n> ")
					})
				})
			} else {
				throw new Error("Incorect amount of files registered (" + context.files.value.length + " != " + this.value.length + ")")
			}
		} else {
			throw new Error("No file names registered")
		}
		return this
	},
	date() {
		return new DataPromise(Promise.all(this.value.map(v => new Promise((resolve, reject) => {
			fs.stat(v, (err, stat) => {
				if (err) return reject(err)

				resolve(stat.birthtime)
			})
		}))))
	},
	read() {
		return new DataPromise(
			Promise.all(this.value.map(v => fs.readFile.promiseNCS(v).then(w => w[1].toString()))).then(v => new Data(v))
		)
	},
	delete() {
		return new DataPromise(
			Promise.all(this.value.map(v => fs.unlink.promiseNCS(v))).then(v => this)
		)
	},
	reverse() {
		return new Data(this.value.copy().reverse())
	}
})

function DataPromise(promise) {
	this.promise = promise
}

Data.prototype.toArray().forEach(v => {
	DataPromise.prototype[v.key] = function (...args) {
		return new DataPromise(new Promise((resolve, reject) => {
			var handler = (data) => {
				if (data instanceof DataPromise) {
					data.promise.then(handler, (err) => reject(err))
				} else if (data instanceof Promise) {
					data.then(handler, (err) => reject(err))
				} else if (data instanceof Data) {
					try {
						resolve(v.value.apply(data, args))
					} catch (err) {
						reject(err)
					}
				} else throw new Error("Invalid type returned from data functions:" + inspect(data))
			}

			handler(this.promise)
		}))
	}
})

function MassData(datas = []) {
	this.datas = datas
}

Data.prototype.toArray().forEach(v => {
	MassData.prototype[v.key] = function (...args) {
		return new MassData(this.datas.map(w => {
			return w[v.key](...args)
		}))
	}
})

MassData.prototype.end = function () {
	var value = []
	if (this.datas[0] instanceof DataPromise) {
		return new DataPromise(new Promise((resolve, reject) => {
			Promise.all(this.datas.map(v => v.promise)).then((data) => {
				data.forEach(v => value.push(v.value))
				resolve(new Data(value))
			}, (err) => reject(err))
		}))

	} else {
		this.datas.forEach(v => value.push(v.value))
		return new Data(value)
	}
}

B.log("  " + process.cwd())
var replI = repl.start({
	useColors: true, ignoreUndefined: true, writer: (output) => {
		if (output instanceof Data) {
			return (inspect(output.value))
		} else if (output instanceof DataPromise) {
			var handler = (data) => {
				if (data instanceof DataPromise) {
					data.promise.then(handler, (err) => B.write("\r" + err.stack + "\n> "))
				} else if (data instanceof Promise) {
					data.then(handler, (err) => B.write("\r" + err.stack + "\n> "))
				} else if (data instanceof Data) {
					try {
						B.write("\r" + inspect(data.value) + "\n> ")
					} catch (err) {
						B.write("\r" + err.stack + "\n> ")
					}
				} else B.write("\r" + inspect(data) + "\n> ")
			}

			handler(output.promise)
			return "Waiting..."
		} else if (output instanceof MassData) {
			return (output.datas.map(output => inspect(output.value)).join(typeFileSeparator))
		} else {
			return (inspect(output))
		}
	}
})
context = replI.context
Object.assign(context, {
	data: new Data(),
	files: null,
	back() {
		context.data = history.pop()
	},
	readfile(path) {
		return new DataPromise(new Promise((resolve, reject) => {
			fs.readFile(path, (error, buffer) => {
				if (error) return reject(error)
				var string = buffer.toString()
				resolve(new Data(string.split("\u001f")))

			})
		}))
	},
	V(...args) {
		return new Data(args)
	},
	readdir(path = ".\\") {
		return new DataPromise(new Promise((resolve, reject) => {
			fs.readdir(path, (error, buffer) => {
				if (error) return reject(error)
				resolve(new Data(buffer))
			})
		}))
	},
	read() {
		if (context.files) {
			return new DataPromise(Promise.all(context.files.value.map((path, i) => {
				return new Promise((resolve, reject) => {
					fs.readFile(path, (err, data) => {
						if (err) return reject(err)

						resolve(data.toString())
						B.write("\rFile " + path + " read\n> ")
					})
				})
			})).then(value => new Data(value)))
		} else {
			throw new Error("No file names registered")
		}
	}
})