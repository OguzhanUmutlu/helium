const {
    throwRuntimeError,
    findVariable,
    throwTypeError,
    O,
    ToStringMap,
    ToColorfulStringMap,
    isIterable,
    getIteratorContents,
    isFunctionReturned
} = require("./utils");

const Operations = {
    "number+number": (a, b) => O.N(a + b),
    "number-number": (a, b) => O.N(a - b),
    "number*number": (a, b) => O.N(a * b),
    "number/number": (a, b, code, pos) => {
        if (b === 0) throwRuntimeError(code, pos, "Division by zero.");
        return O.N(a / b);
    },
    "number//number": (a, b, code, pos) => {
        if (b === 0) throwRuntimeError(code, pos, "Division by zero.");
        return O.N(Math.floor(a / b));
    },
    "number&number": (a, b) => O.N(a & b),
    "number|number": (a, b) => O.N(a | b),
    "number^number": (a, b) => O.N(a ^ b),
    "number**number": (a, b) => O.N(a ** b),

    "string+string": (a, b) => O.S(a + b),
    "string*number": (a, b) => O.S(a.repeat(b)),
    "number*string": (a, b) => O.S(b.repeat(a)),
    "boolean+number": (a, b) => O.N(b + (a ? 1 : 0)),
    "number+boolean": (a, b) => O.N(a + (b ? 1 : 0)),
    "iterable+iterable": (a, b) => O.I([...a, ...b]),
    "iterable-iterable": (a, b) => O.I(a.filter(i => !b.includes(i)))
};

function getObjectProperty(code, pos, scope, props) {
    let target = executeExpression(code, scope, [props[0]]);
    for (let i = 1; i < props.length; i++) {
        let prop = props[i];
        if (typeof prop !== "string") {
            const res = executeExpression(code, scope, prop.ready[0]);
            prop = ToStringMap[res.type](res);
        }
        if (!target || (target.type !== "object" && !isIterable(target))) {
            throwRuntimeError(code, pos, "Cannot index into a non-iterable: ." + prop);
        }
        if (isIterable(target)) {
            const k = parseInt(prop);
            if (isNaN(k) || Math.floor(k) !== k || k < 0) {
                throwRuntimeError(code, pos, "Invalid index for the list.");
            }
        }
        target = target.value[prop];
        if (typeof target === "string") target = O.S(target);
    }
    return target;
}

function setObjectPropertyPre(code, pos, scope, props, full) {
    const p = getObjectProperty(code, pos, scope, props);
    if (!p || (p.type !== "object" && !isIterable(p))) {
        throwRuntimeError(code, pos, "Cannot index into a non-iterable.");
    }
    if (isIterable(p)) {
        const k = parseInt(full.at(-1));
        if (isNaN(k) || Math.floor(k) !== k || k < 0) {
            throwRuntimeError(code, pos, "Invalid index for the list.");
        }
    }
    return p;
}

function makeSetOperation(op) {
    return function (code, pos, scope, prop, got, after) {
        const found = findVariable(scope, typeof prop === "string" ? prop : prop[0]);
        let lst;
        let aft;
        if (!found) throwTypeError(code, pos, "Undefined variable.");
        if (typeof prop === "string") {
            lst = found.scope.variables[prop];
            aft = found.scope.variables[prop] = evaluateBasicExpression(code, pos, scope, found.variable, op, got);
        } else {
            const p = setObjectPropertyPre(code, pos, scope, found.scope.variables[prop[0]], prop.slice(1, -1), prop);
            lst = p.value[prop.at(-1)];
            aft = p.value[prop.at(-1)] = evaluateBasicExpression(code, pos, scope, p.value[prop.at(-1)] || O.None, op, got);
        }
        return after ? aft : lst;
    };
}

const SetOperations = {
    ":="(code, pos, scope, prop, got) {
        if (typeof prop !== "string") throwRuntimeError(code, pos, "The := set operator can only be used on dotless variables.");
        return scope.variables[prop] = got;
    },
    "="(code, pos, scope, prop, got) {
        const found = findVariable(scope, typeof prop === "string" ? prop : prop[0]);
        if (found) {
            if (typeof prop === "string") return found.scope.variables[prop] = got;
            const st = found.scope.variables[prop[0]];
            const p = setObjectPropertyPre(code, pos, scope, st, prop.slice(1, -1), prop, 1);
            return p.value[prop.at(-1)] = got;
        }
        if (typeof prop !== "string") throwRuntimeError(code, pos, "Undefined variable.");
        return scope.variables[prop] = got;
    },
    "+=": makeSetOperation("+"),
    "-=": makeSetOperation("-"),
    "*=": makeSetOperation("*"),
    "/=": makeSetOperation("/"),
    "//=": makeSetOperation("//"),
    "&=": makeSetOperation("&"),
    "|=": makeSetOperation("|"),
    "^=": makeSetOperation("^"),
    "**=": makeSetOperation("**"),
    "&&=": makeSetOperation("&&"),
    "||=": makeSetOperation("||"),
    "??=": makeSetOperation("??"),
};

const BuiltInVariables = {
    print: {
        type: "function", native: true, call(code, pos, scope, args) {
            process.stdout.write(args.map(i => ToColorfulStringMap[i.type](i)).join(" ") + "\n");
            return O.None;
        }
    },
    str: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length === 0) {
                throwRuntimeError(code, pos, "str() function expects at least 1 argument.");
            }
            const res = args.map(i => O.S(ToStringMap[i.type](i)));
            return res.length === 1 ? res[0] : O.I(res);
        }
    },
    int: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length === 0) return O.N(0);
            if (args[0].type !== "string") {
                throwTypeError(code, pos, "int() input should be a string.");
            }
            if (args.length > 1) {
                if (args[1].type !== "number") {
                    throwTypeError(code, pos, "int() base must be an integer.");
                }
                if (args[1].value !== Math.floor(args[1].value)) {
                    throwTypeError(code, pos, "int() base cannot be a float.");
                }
                if (args[1].value < 2 || args[1].value > 36) {
                    throwTypeError(code, pos, "int() base must be >= 2 and <= 36.");
                }
            }
            const base = args.length > 1 ? args[1].value : 10;
            const res = parseInt(args[0].value, base);
            if (isNaN(res)) {
                throwTypeError(code, pos, "Invalid literal for int() with base " + base + ": " + JSON.stringify(args[0].value));
            }
            return res;
        }
    },
    float: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length === 0) return O.N(0);
            if (args[0].type !== "string") {
                throwTypeError(code, pos, "float() input should be a string.");
            }
            const res = parseFloat(args[0].value);
            if (isNaN(res)) {
                throwTypeError(code, pos, "Invalid literal for float() " + ": " + JSON.stringify(args[0].value));
            }
            return res;
        }
    },
    len: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length === 0) {
                throwRuntimeError(code, pos, "len() function expects at least 1 argument.");
            }
            if (args.some(i => i.type !== "iterable" && i.type !== "string")) {
                throwRuntimeError(code, pos, "len() function expects iterables as arguments.");
            }
            return O.I(args.map(i => O.N(i.value.length)));
        }
    },
    typeof: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length === 0) {
                throwRuntimeError(code, pos, "typeof() function expects at least 1 argument.");
            }
            return args[0].type;
        }
    },
    split: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length === 0) {
                throwRuntimeError(code, pos, "split() function expects at least 1 argument.");
            }
            if (args[0].type !== "string") {
                throwRuntimeError(code, pos, "split() function expects a string as an argument.");
            }
            if (args.length > 1 && args[1].type !== "string") {
                throwRuntimeError(code, pos, "split() function expects a string for the splitter.");
            }
            return O.I(args[0].value.split(args.length > 1 ? args[1].value : " ").map(O.S));
        }
    },
    chr: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length === 0) {
                throwRuntimeError(code, pos, "chr() function expects 1 argument.");
            }
            if (args[0].type !== "number") {
                throwRuntimeError(code, pos, "chr() function expects a number as an argument.");
            }
            return O.S(String.fromCharCode(args[0].value));
        }
    },
    ord: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length === 0) {
                throwRuntimeError(code, pos, "ord() function expects 1 argument.");
            }
            if (args[0].type !== "string") {
                throwRuntimeError(code, pos, "ord() function expects a character as an argument.");
            }
            if (args[0].value.length !== 1) {
                throwRuntimeError(code, pos, "ord() function expects exactly 1 character as an argument.");
            }
            return O.N(args[0].value.charCodeAt(0));
        }
    },
    exit: {
        type: "function", native: true, call(code, pos, scope, args) {
            if (args.length > 0 && args[0].type !== "number") {
                throwRuntimeError(code, pos, "exit() expects a number for the exit code.");
            }
            process.exit(args.length > 0 ? args[0].value : 0);
        }
    }
};

function executeExpression(code, scope, ready) {
    if (ready.length === 1) {
        return evaluateSingleExpression(code, scope, ready[0]);
    }
    const stack = [];

    for (const token of ready) {
        if (token.type !== "operator") {
            stack.push(token);
            continue;
        }

        const right = evaluateSingleExpression(code, scope, stack.pop());
        const left = evaluateSingleExpression(code, scope, stack.pop());

        stack.push(evaluateBasicExpression(code, token.pos, scope, left, token.value, right));
    }

    return stack.pop();
}

function evaluateSingleExpression(code, scope, token) {
    if (token.type === "number") return O.N(parseFloat(token.value));
    if (token.type === "string") return O.S(token.value);
    if (token.type === "group") return executeExpression(code, scope, token.ready);
    if (token.type === "list") {
        const list = [];
        for (const t of token.ready) {
            if (t.length === 2 && t[0].type === "symbol" && t[0].value === "...") {
                const v = executeExpression(code, scope, [t[1]]);
                if (!isIterable(v)) {
                    throwRuntimeError(code, token.pos, "Expected an iterable for the spread operator.");
                }
                list.push(...getIteratorContents(v));
                continue;
            }
            list.push(executeExpression(code, scope, t));
        }
        return O.I(list);
    }
    if (token.type === "object") {
        const obj = {};
        for (const r of token.ready) {
            let key;
            if (r.isSpread) {
                const v = executeExpression(code, scope, r.ready);
                if (v.type !== "object") {
                    throwRuntimeError(code, v.pos, "Expected an object for the spread operator.");
                }
                for (const k in v.value) {
                    obj[k] = v.value[k];
                }
                continue;
            }
            if (r.isPointer) {
                const e = executeExpression(code, scope, r.key.ready[0]);
                key = ToStringMap[e.type](e);
            } else key = r.key.value;
            obj[key] = executeExpression(code, scope, r.ready);
        }
        return O.OBJ(obj);
    }
    if (token.type === "word") {
        if (token.value === "None") return O.None;
        if (token.value === "True") return O.True;
        if (token.value === "False") return O.False;
        const variable = findVariable(scope, token.value);
        if (!variable) throwTypeError(code, token.pos, "Undefined variable.");
        return variable.variable;
    }
    if (token.type === "prop") {
        const got = getObjectProperty(code, token.pos, scope, token.value);
        return got || O.None;
    }
    if (token.type === "function_call") {
        const variable = findVariable(scope, token.name);
        if (!variable) throwTypeError(code, token.pos, "Undefined function.");
        if (variable.variable.type !== "function") throwTypeError(code, token.pos, "Cannot call a non-function.");
        const args = token.ready.map(r => executeExpression(code, scope, r));
        if (variable.variable.native) {
            return variable.variable.call(code, token.pos, scope, args);
        }
        const functionScope = {
            type: "function",
            parent: scope,
            variables: {},
            returned: null
        };
        const defArgs = variable.variable.arguments;
        for (let i = 0; i < defArgs.length; i++) {
            const def = defArgs[i];
            if (def.spread) {
                functionScope.variables[def.name] = O.I(args.slice(i));
                continue;
            }
            functionScope.variables[def.name] = i < args.length ? args[i] : (def.default ? executeExpression(code, variable.variable.scope, def.default) : O.None);
        }
        interpret(code, variable.variable.statements, functionScope);
        return functionScope.returned ?? O.None;
    }
    if (token.type === "set_variable") {
        const prop = token.name.type === "word"
            ? token.name.value
            : token.name.value.map(r => {
                if (typeof r === "string") return r;
                const res = executeExpression(code, scope, r.ready[0]);
                return ToStringMap[res.type](res);
            });
        const op = token.operator;
        const got = executeExpression(code, scope, token.ready);
        const handler = SetOperations[op];
        if (!handler) throwRuntimeError(code, token.pos, "Unhandled set operation.");
        return handler(code, token.pos, scope, prop, got, token.after);
    }
    if (token.type === "operator") return O.OP(token.value);
    throwTypeError(code, token.pos, "Unexpected token.");
}

function evaluateBasicExpression(code, pos, scope, a, op, b) {
    // number, string, array, object, function
    const r = Operations[a.type + op + b.type];
    if (!r) throwRuntimeError(code, pos, "Cannot compute: " + a.type + " " + op + " " + b.type);
    /*if (op === "&&") {
        if (a.type === "iterable") return b;
        if (a.type === "string") return a.value.length ? a : b;
    }*/
    return r(a.value, b.value, code, pos);
}

const StatementHandler = {
    execution(code, statement, scope) {
        executeExpression(code, scope, statement.ready);
    },
    function_declaration(code, statement, scope) {
        scope.variables[statement.name] = O.F(statement.arguments, statement.statements, scope);
    },
    return(code, statement, scope) {
        scope.returned = executeExpression(code, scope, statement.ready);
    }
};

function executeStatement(code, statement, scope) {
    if (isFunctionReturned(scope)) return;
    const handler = StatementHandler[statement.type];
    if (!handler) throwRuntimeError(code, statement.pos, "Unexpected statement. (" + statement.type + ")");
    handler(code, statement, scope);
}

function interpret(code, statements, scope) {
    if (scope.type === "main") {
        Object.assign(scope.variables, BuiltInVariables);
    }

    for (let i = 0; i < statements.length; i++) {
        executeStatement(code, statements[i], scope)
    }
}

module.exports = {interpret};