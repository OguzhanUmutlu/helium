// Operator descriptor that determines how operators behave
const OperatorDescriptor = {
    "**": {
        p: 4,
        a: "right",
    },
    "*": {
        p: 3,
        a: "left",
    },
    "/": {
        p: 3,
        a: "left",
    },
    "+": {
        p: 2,
        a: "left",
    },
    "-": {
        p: 2,
        a: "left",
    },
};

// Basic terminal color support
const Color = {
    rgb: (r, g, b) => text => `\x1B[38;2;${r};${g};${b}m${text}\x1B[39m`,

    reset: text => `\x1B[0m${text}\x1B[0m`,

    black: text => `\x1B[30m${text}\x1B[39m`,
    red: text => `\x1B[31m${text}\x1B[39m`,
    green: text => `\x1B[32m${text}\x1B[39m`,
    yellow: text => `\x1B[33m${text}\x1B[39m`,
    blue: text => `\x1B[34m${text}\x1B[39m`,
    magenta: text => `\x1B[35m${text}\x1B[39m`,
    cyan: text => `\x1B[36m${text}\x1B[39m`,
    white: text => `\x1B[37m${text}\x1B[39m`,

    blackBright: text => `\x1B[90m${text}\x1B[39m`,
    redBright: text => `\x1B[91m${text}\x1B[39m`,
    greenBright: text => `\x1B[92m${text}\x1B[39m`,
    yellowBright: text => `\x1B[93m${text}\x1B[39m`,
    blueBright: text => `\x1B[94m${text}\x1B[39m`,
    magentaBright: text => `\x1B[95m${text}\x1B[39m`,
    cyanBright: text => `\x1B[96m${text}\x1B[39m`,
    whiteBright: text => `\x1B[97m${text}\x1B[39m`
};

const numberCache = {};
const stringCache = {};

const O = {
    N: value => numberCache[value] ??= {type: "number", value},
    S: value => stringCache[value] ??= {type: "string", value},
    I: value => ({type: "iterable", value}),
    OP: value => ({type: "operator", value}),
    OBJ: value => ({type: "object", value}),
    F: (arguments, statements, scope) => ({type: "function", native: false, arguments, statements, scope}),
    F_N: call => ({type: "function", native: true, call}),
    None: {type: "none"},
    True: {type: "boolean", value: true},
    False: {type: "boolean", value: false},
};

function iterableToStr(map, v, dots) {
    if (v.value.length === 0) return "[]";
    const scanned = [v];
    const arr = v.value; // Array.from({length: v.value.length}, (_, i) => v.value[i]);
    return "[" + arr.map(i => {
        const str = scanned.includes(i)
            ? (i.type === "iterable" ? "[" + dots + "]" : "{" + dots + "}")
            : map[i.type](i, true);
        if (i.type === "object" || i.type === "iterable") scanned.push(i);
        return str;
    }).join(", ") + "]"
}

function objToStr(map, v, dots) {
    const keys = Object.keys(v.value);
    if (keys.length === 0) return "{}";
    const scanned = [v];
    return "{" + keys.map(i => {
        const l = v.value[i];
        const str = map.string({value: i}, true) + ": " + (
            scanned.includes(l)
                ? (l.type === "iterable" ? "[" + dots + "]" : "{" + dots + "}")
                : map[l.type](l)
        );
        if (l.type === "object" || l.type === "iterable") scanned.push(l);
        return str;
    }).join(", ") + "}";
}

const ToStringMap = {
    number: v => v.value.toString(),
    string: (v, json) => json ? JSON.stringify(v.value) : v.value,
    function: v => v.native ? "<native function>" : "<function>",
    iterable: v => iterableToStr(ToStringMap, v, "..."),
    object: v => objToStr(ToStringMap, v, "..."),
    none: () => "None",
    boolean: v => v.value ? "True" : "False",
};

const ToColorfulStringMap = {
    number: v => Color.yellow(v.value.toString()),
    string: (v, json) => json ? Color.green(JSON.stringify(v.value)) : v.value,
    function: v => Color.blue(v.native ? "<native function>" : "<function>"),
    iterable: v => iterableToStr(ToColorfulStringMap, v, Color.magenta("...")),
    object: v => objToStr(ToColorfulStringMap, v, Color.magenta("...")),
    none: () => Color.blackBright("None"),
    boolean: v => Color.yellow(v.value ? "True" : "False"),
};

// Turns token to a boolean
function tokenToBool(token) {
    if (token.type === "number") return token.value !== 0;
    if (token.type === "string") return token.value.length > 0;
    if (token.type === "none") return false;
    if (token.type === "boolean") return token.value;
    return true;
}

// Returns if the token is an iterable
function isIterable(token) {
    return token.type === "iterable" || token.type === "string";
}

// Returns the iterator contents
function getIteratorContents(it) {
    return it.type === "string" ? it.value.split("").map(i => O.S(i)) : it.value;
}

// Finds end of the expression
function findEOE(code, tokens, index) {
    let expectsOperator = false;
    for (; index < tokens.length; index++) {
        const token = tokens[index];
        if (expectsOperator !== (token.type === "operator")) break;
        expectsOperator = !expectsOperator;
    }
    return index;
}

// Makes a token position object
function mkPos(start, end) {
    return new Proxy({start, end}, {
        get(_, p) {
            if (p === "start") return start;
            if (p === "end") return end;
            if (p === "value") return code => code.substring(start, end);
        },
        set(_, p, v) {
            if (p === "start") return start = v;
            if (p === "end") return end = v;
        }
    });
    /*return {
        start, end, value(code) {
            return code.substring(this.start, this.end);
        }
    };*/
}

// Throws an error using the given position on the given code
function throwError(code, pos, type, error) {
    const lines = code.split("\n");
    let line = 0;
    let key = 0;
    const index = pos.start;
    for (let i = 0; i <= index; i++) {
        key++;
        if (code[i] === "\n") {
            line++;
            key = 0;
        }
    }
    let lenTmp = pos.end - index;
    for (let i = -2; i <= 10; i++) {
        const l = line + i;
        if (!(l in lines)) continue;
        const ln = lines[l];
        if (i === 0) {
            const fills = Math.min(lenTmp, ln.length);
            lenTmp -= fills;
            console.error(
                Color.red("> ") +
                Color.blue(l + 1) +
                Color.blue(" | ") +
                Color.blue(ln.substring(0, key - 1)) +
                Color.red(ln.substring(key - 1, key - 1 + fills) ?? "") +
                Color.blue(ln.substring(key - 1 + fills))
            );
            /*console.error(
                " ".repeat(key + l.toString().length + 4) +
                red("^".repeat(pointerLength))
            );*/
        } else if (i > 0) {
            const fills = Math.min(lenTmp, ln.length);
            lenTmp -= fills;
            console.error(
                Color.red(fills > 0 ? "> " : "  ") +
                Color.blue(l + 1) +
                Color.blue(" | ") +
                Color.red(ln.substring(0, fills) ?? "") +
                Color.blue(ln.substring(fills))
            );
            /*console.error(
                " ".repeat(l.toString().length + 5) +
                red("^".repeat(fills))
            );*/
        } else {
            console.error(
                Color.blue("  " + (l + 1) + " | " + ln)
            );
        }
    }
    console.error("\n" + Color.red(type + ": " + error));
    process.exit(1);
}

function throwSyntaxError(code, pos, error) {
    throwError(code, pos, "SyntaxError", error);
}

function throwTypeError(code, pos, error) {
    throwError(code, pos, "TypeError", error);
}

function throwRuntimeError(code, pos, error) {
    throwError(code, pos, "RuntimeError", error);
}

// Splits the tokens to comma symbols
function splitToCommas(tokens) {
    if (tokens.length === 0) return [];
    const list = [[]];
    let index = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === "symbol" && token.value === ",") {
            index++;
            list.push([]);
            continue;
        }
        list[index].push(token);
    }
    if (list[index].length === 0) list.splice(-1, 1);
    return list;
}

// Finds the variable in the given scope or in its parent scopes
function findVariable(scope, name) {
    let current = scope;
    while (!current.variables[name]) {
        if (!current.parent) return null;
        current = current.parent;
    }
    return {scope: current, variable: current.variables[name]};
}

// Finds the closest parent scope that is a function
function findFunctionParent(scope) {
    let current = scope;
    while (current.type !== "function") {
        if (!current.parent) return null;
        current = current.parent;
    }
    return current;
}

// Returns if the closest function scope has returned
function isFunctionReturned(scope) {
    const func = findFunctionParent(scope);
    return func && func.returned;
}

// Sorts the tokens so that it is calculable
function makeShun(tokens) {
    const stack = [];
    const output = [];

    for (let token of tokens) {
        if (token.type !== "operator") {
            output.push(token);
            continue;
        }
        const o1 = token;
        let o2 = stack.at(-1);
        while (
            o2 &&
            (OperatorDescriptor[o2.value].p > OperatorDescriptor[o1.value].p ||
                (OperatorDescriptor[o2.value].p === OperatorDescriptor[o1.value].p &&
                    OperatorDescriptor[o1.value].a === "left"))
            ) {
            output.push(stack.pop());
            o2 = stack.at(-1);
        }
        stack.push(o1);
    }

    while (stack.length !== 0) {
        output.push(stack.pop());
    }

    return output;
}

module.exports = {
    findEOE,
    mkPos,
    throwError,
    throwSyntaxError,
    throwTypeError,
    throwRuntimeError,
    Color,
    splitToCommas,
    findVariable,
    makeShun,
    O,
    ToStringMap,
    ToColorfulStringMap,
    tokenToBool,
    isIterable,
    getIteratorContents,
    findFunctionParent,
    isFunctionReturned
};