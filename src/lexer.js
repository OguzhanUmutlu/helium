const {
    mkPos,
    findEOE,
    throwSyntaxError,
    makeShun,
    splitToCommas,
    O
} = require("./utils");
const SymbolRegex = /^([()\[\]{},:]|\.{3}|\.)/;
const OperatorRegex = /^(<{1,3}|>{1,3}|&{1,2}|\|{1,2}|[<>=!]=|\*\*|[+\-*/&|^!~]|\/\/|>=|<=)/;
const SetRegex = /^(\+\+|--|(\*\*|[+\-*/:^&|]|\/\/|&&|\|{2}|\?\?|<{2,3}|>{2,3})?=)/;
const StringStarterChars = [
    "\"", "'", "`"
];
const IgnoringChars = [
    "\n", "\t", "\r", "\f", " ", ";"
];
const SymbolChars = [
    ">", "<", "&", "|", "=", "!", "~", "*", "?", "+", "-", "*", "/", "^", "(", ")", "[", "]", "{", "}", ",", ":", "."
];
const IntegerChars = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"
];
const AllChars = [
    ...StringStarterChars, ...IgnoringChars, ...SymbolChars, ...IntegerChars
];
const StringModes = ["f", "r"];
const GroupMatch = {
    "(": ")",
    "[": "]",
    "{": "}"
};
const UnaryAfterOperators = [
    "++", "--"
];
const UnaryOperators = [
    "+", "-", "!", "~", ...UnaryAfterOperators
];

function makeRegexHandler(type, regex, isNum = false) {
    return function (code, index, tokens) {
        const match = code.substring(index).match(regex);
        if (!match) return null;
        tokens.push({type, pos: mkPos(index, index + match[0].length), value: isNum ? parseFloat(match[0]) : match[0]});
        index += match[0].length;
        return index;
    };
}

const TokenHandlers = [
    function (code, index) {
        return IgnoringChars.includes(code[index]) ? ++index : null;
    },
    function (code, index) {
        if (code[index] !== "#") return null;
        index++;
        for (; index < code.length; index++) {
            if (code[index] === "\n") break;
        }
        return index + 1;
    },
    makeRegexHandler("set", SetRegex),
    makeRegexHandler("operator", OperatorRegex),
    makeRegexHandler("symbol", SymbolRegex),
    function (code, index, tokens) {
        if (!IntegerChars.includes(code[index])) return null;
        const startIndex = index;
        let str = code[index];
        let hasDot = false;
        let hasE = false;
        let hasESign = false;
        let hasEBegan = false;
        let canUnderscore = false;
        index++;
        for (; index < code.length; index++) {
            const c = code[index];
            if (c === "e") {
                if (hasE) break;
                hasE = true;
                str += "e";
                canUnderscore = false;
                continue;
            }
            if (c === "+" || c === "-") {
                if (!hasE || hasESign) break;
                hasESign = true;
                str += c;
                canUnderscore = false;
                continue;
            }
            if (c === ".") {
                if (hasDot) break;
                hasDot = true;
                str += c;
                canUnderscore = false;
                continue;
            }
            if (c === "_") {
                if (!canUnderscore) break;
                canUnderscore = false;
                continue;
            }
            if (!IntegerChars.includes(code[index])) break;
            if (hasE) hasEBegan = true;
            canUnderscore = true;
            str += c;
        }
        if (hasE && !hasEBegan) throwSyntaxError(code, mkPos(startIndex, index), "Expected integers after the 'e' symbol.");
        // 10_0.5_0
        // 10_0.5
        // 10.5_0
        // 10.5
        // 10.
        // 10
        tokens.push({
            type: "number", pos: mkPos(startIndex, index), value: parseFloat(str)
        });
        return index;
    },
    function (code, index, tokens) {
        const start = code[index];
        if (!StringStarterChars.includes(start)) return null;
        let startIndex = index;
        const lastToken = tokens[tokens.length - 1];
        const mode = lastToken && lastToken.type === "word" && StringModes.includes(lastToken.value) ? lastToken.value : null;
        if (mode) tokens.splice(-1, 1);
        index++;
        let str = "";
        let backslash = false;
        for (; index < code.length; index++) {
            const c = code[index];
            if (c === start && !backslash) break;
            if (mode === "f" && c === "{" && !backslash) {
                let cInd = index;
                tokens.push(
                    {type: "string", pos: mkPos(startIndex, index), value: str, mode},
                    {type: "symbol", pos: mkPos(index, index + 1), value: "+"},
                    {type: "word", pos: mkPos(index, index + 1), value: "str"},
                    {type: "symbol", pos: mkPos(index, index + 1), value: "("}
                );
                index++;
                str = "";
                let inc = 0;
                while (true) {
                    const c = code[index];
                    if (c === "{") inc++;
                    if (c === "}") {
                        inc--;
                        if (inc === -1) {
                            break;
                        }
                    }
                    if ((index = processChar(code, index, tokens)) >= code.length) break;
                }
                if (inc !== -1) {
                    throwSyntaxError(code, mkPos(cInd, cInd + 1), "Expected the '{' character to have a matching '}' character.", length);
                }
                startIndex = index;
                tokens.push(
                    {type: "symbol", pos: mkPos(index, index + 1), value: ")"},
                    {type: "symbol", pos: mkPos(index, index + 1), value: "+"}
                );
                continue;
            }
            if (c === "\\") backslash = !backslash;
            else backslash = false;
            str += c;
        }
        if (index === code.length) {
            throwSyntaxError(code, mkPos(startIndex, index), "Expected the string to have an ending.");
        }
        tokens.push({type: "string", pos: mkPos(startIndex, index), value: str, mode});
        return index + 1;
    },
    function (code, index, tokens) {
        if (AllChars.includes(code[index])) return null;
        const startIndex = index;
        let str = "";
        for (; index < code.length; index++) {
            const c = code[index];
            if (AllChars.includes(c)) break;
            str += c;
        }
        tokens.push({
            type: "word",
            pos: mkPos(startIndex, index),
            value: str
        });
        return index;
    }
];

const f3List = ["symbol", "set", "operator"];
const f3NonValList = [")", "]", "}"];

function processChar(code, index, tokens) {
    for (const handler of TokenHandlers) {
        const res = handler(code, index, tokens);
        if (res !== null) {
            if (tokens.length > 1) {
                const f1 = tokens.at(-1);
                const f2 = tokens.at(-2);
                const f3 = tokens.at(-3);
                if (
                    (f2.type === "operator" || f2.type === "set") // 2 back should be an operator or a setter
                    && UnaryOperators.includes(f2.value) // and 2 back should be a unary operator/setter
                    && ( // and:
                        f2.type === "set" // the unary token should be a setter
                        || !f3 // or the 3 back just shouldn't exist
                        || (f3List.includes(f3.type) && !f3NonValList.includes(f3.value)) // or the 3 back shouldn't be operable
                    ) && f1.type !== "symbol"
                ) {
                    if (f2.type === "set" && f1.type !== "word" && f1.type !== "prop") {
                        throwSyntaxError(code, f2.pos, "Unary setter expects a variable after/before it.");
                    }
                    switch (f2.value) {
                        case "+":
                            tokens.splice(-2, 1);
                            break;
                        case "-":
                            tokens.splice(-2, 0, {
                                type: "number", pos: f2.pos, value: 0
                            });
                            break;
                        case "~":
                        case "!":
                            tokens.splice(-2, 2, {
                                type: "group", sym: "(", pos: mkPos(f2.pos.start, f1.pos.end),
                                ready: [f1, null, O.OP(f2.value)]
                            });
                            break;
                        case "++":
                        case "--": // ++x
                            tokens.splice(-2, 2, {
                                type: "set_variable",
                                after: true,
                                pos: mkPos(f2.pos.start, f1.pos.end),
                                name: f1,
                                operator: f2.value[0] + "=",
                                ready: [O.N(1)]
                            });
                            break;
                    }
                } else if (
                    f1.type === "set" // 1 back should be a setter
                    && UnaryAfterOperators.includes(f1.value) // and 1 back should be a unary-after operator
                    && (f2.type === "word" || f2.type === "prop")
                ) {
                    tokens.splice(-2, 2, {
                        type: "set_variable",
                        after: false,
                        pos: mkPos(f2.pos.start, f1.pos.end),
                        name: f2,
                        operator: f1.value[0] + "=",
                        ready: [O.N(1)]
                    });
                }
            }
            return res;
        }
    }
    throwSyntaxError(code, mkPos(index, index + 1), "Unexpected character.");
}

function tokenize(code) {
    const tokens = [];

    let index = 0;
    while ((index = processChar(code, index, tokens)) < code.length) {
    }

    return tokens;
}

function checkSet(code, p) {
    for (let i = 0; i < p.children.length; i++) {
        const c = p.children[i];
        if (c.type === "set" && !UnaryOperators.includes(c.value)) {
            if (i === 0) throwSyntaxError(code, c.pos, "Expected a variable before a setter.");
            const name = p.children[i - 1];
            if (name.type !== "word" && name.type !== "prop") throwSyntaxError(code, name.pos, "Expected a variable before a setter.");
            const eoe = findEOE(code, p.children, i + 1);
            const got = p.children.slice(i + 1, eoe);
            if (got.length < 1) {
                throwSyntaxError(code, c.pos, "Expected an expression for the variable declaration statement.");
            }
            p.children.splice(i - 1, eoe - i + 1, {
                type: "set_variable",
                after: true,
                pos: mkPos(name.pos.start, got.at(-1).pos.end),
                name,
                operator: c.value,
                ready: makeShun(got)
            });
            i--;
            continue;
        }
        if (c.type === "word" && c.value === "return") {
            const eoe = findEOE(code, p.children, i + 1);
            const got = p.children.slice(i + 1, eoe);
            p.children.splice(i, eoe - i, {
                type: "return",
                pos: mkPos(c.pos.start, (got.at(-1) ?? c).pos.end),
                ready: got.length ? makeShun(got) : null
            });
            continue;
        }
        if (c.type === "list") {
            const last = p.children[i - 1];
            if (last.type === "prop") {
                last.value.push(c);
                p.children.splice(i, 1);
                i--;
                continue;
            } else if (last.type !== "symbol") {
                p.children.splice(i - 1, 2, {
                    type: "prop",
                    pos: mkPos(last.pos.start, c.pos.end),
                    value: [last, c]
                });
                continue;
            }
        }
        if (c.type === "word") {
            const last = p.children[i - 1];
            const last2 = p.children[i - 2];
            if (last && last.type === "symbol" && last.value === "." && last2 && last2.type !== "symbol") {
                if (last2.type === "prop") {
                    p.children.splice(i - 1, 2);
                    i -= 2;
                    last2.value.push(c.value);
                    last2.pos = mkPos(last2.pos.start, c.pos.end);
                } else {
                    p.children.splice(i - 2, 3, {
                        type: "prop",
                        pos: mkPos(last2.pos.start, c.pos.end),
                        value: [last2, c.value]
                    });
                    i -= 2;
                }
                continue;
            }
        }
    }
}

function groupTokens(code, tokens) {
    let program = {children: []};
    let parent = program;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === "symbol") {
            const match = GroupMatch[token.value];
            if (match) {
                parent = {
                    type: "group",
                    parent,
                    children: [],
                    sym: token.value,
                    closer: match,
                    pos: token.pos.start
                };
                continue;
            } else if (parent.closer === token.value) {
                const p = parent;
                parent = p.parent;
                delete p.parent;
                delete p.closer;
                p.pos = mkPos(p.pos, token.pos.end);
                const last2 = parent.children.at(-2);
                const last = parent.children.at(-1);
                const isFunctionDeclaration1 = p.sym === "(" && last && last.type === "word" && last.value === "function";
                const isFunctionDeclaration2 = p.sym === "(" && last2 && last2.type === "word" && last2.value === "function";
                const isFunctionDeclaration = isFunctionDeclaration1 || isFunctionDeclaration2;
                const isFunctionCall = !isFunctionDeclaration
                    && p.sym === "("
                    && last
                    && last.type === "word";
                const children = p.children;
                checkSet(code, p);
                if (isFunctionCall) {
                    const split = splitToCommas(children);
                    parent.children.splice(-1, 1, {
                        type: "function_call",
                        name: last.value,
                        pos: mkPos(last.pos.start, p.pos.end),
                        children: split,
                        ready: split.map(makeShun)
                    });
                } else if (p.sym === "[") {
                    const split = splitToCommas(children);
                    const ls = {
                        type: "list",
                        pos: p.pos,
                        ready: split.map(makeShun)
                    };
                    /*const last = parent.children.at(-1);
                    if (last && last.type !== "symbol" && (last.type !== "word" || !SpecialWords.includes(last.value))) {
                        if (last.type !== "prop") {
                            parent.children.splice(-1, 1, {
                                type: "prop",
                                pos: mkPos(last.pos.start, p.pos.end),
                                value: [last, ls]
                            });
                        } else {
                            last.value.push(ls);
                            if (ls.ready.length !== 1) {
                                throwSyntaxError(code, ls.pos, "Expected a single expression inside the object pointer.");
                            }
                            last.pos.end = ls.pos.end;
                        }
                    } else*/
                    parent.children.push(ls);
                } else if (p.sym === "{") {
                    // {x: 30, [x]: 50, 5: "hello": 25}
                    const split = splitToCommas(children);
                    const ready = [];
                    for (let i = 0; i < split.length; i++) {
                        const s = split[i];
                        // it will always have a first element because that's just how splitToCommas works
                        if (
                            s.length === 2
                            && s[0].type === "symbol"
                            && s[0].value === "..."
                        ) {
                            ready.push({
                                isSpread: true,
                                isPointer: false,
                                key: null,
                                ready: [s[1]]
                            });
                            continue;
                        }
                        if (s.length < 3) throwSyntaxError(code, s[0].pos, "Expected at least 3 tokens for the property.");
                        if (!["word", "number", "list"].includes(s[0].type)) {
                            throwSyntaxError(code, s[0].pos, "Expected a string, number or a pointer.");
                        }
                        if (s[0].type === "list" && s[0].ready.length !== 1) {
                            throwSyntaxError(code, s[0].pos, "Expected a single expression inside the pointer.");
                        }
                        if (s[1].type !== "symbol" || s[1].value !== ":") {
                            throwSyntaxError(code, s[1].pos, "Expected a semicolon.");
                        }
                        ready.push({
                            isSpread: false,
                            isPointer: s[0].type === "list",
                            key: s[0],
                            ready: s.slice(2)
                        });
                    }
                    parent.children.push({
                        type: "object",
                        pos: p.pos,
                        ready
                    });
                } else {
                    p.ready = makeShun(children);
                    parent.children.push(p);
                }
                if (!isFunctionCall && !isFunctionDeclaration && p.sym === "(" && children.length % 2 !== 1 && children.length !== 0) {
                    throwSyntaxError(code, p.pos, "Invalid expression.");
                }
                continue;
            }
        }
        parent.children.push(token);
    }
    if (program !== parent) {
        throwSyntaxError(code, parent.pos, "Unfinished bracket.");
    }
    checkSet(code, program);
    return program.children;
}

module.exports = {tokenize, groupTokens};