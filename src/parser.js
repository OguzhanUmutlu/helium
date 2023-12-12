const {
    mkPos,
    findEOE,
    throwSyntaxError,
    makeShun,
    splitToCommas
} = require("./utils");

function checkSyntax(tokens, index, expectations) {
    for (let i = 0; i < expectations.length; i++) {
        if (!(index + i in tokens)) return false;
        const token = tokens[index + i];
        const exp = expectations[i];
        if (exp.some(i => token[i[0]] !== i[1])) return false;
    }
    return true;
}

// Finds the end of the statement, aka the 'end' keyword that isn't associated with anything else
function findEOS(code, index, tokens, statements) {
    const stIndex = statements.length;
    let endToken = null;
    for (; index < tokens.length;) {
        const token = tokens[index];
        if (token.type === "word" && token.value === "end") {
            endToken = token;
            break;
        }
        index = processToken(code, index, tokens, statements);
    }
    if (!endToken) return null;
    return [index, statements.splice(stIndex), endToken];
}

function processFunctionArgument(code, pos, tokens) {
    if (tokens.length === 0) throwSyntaxError(code, pos, "Empty argument.");
    const first = tokens[0];
    if (first.type === "word") {
        return {
            name: first.value
        };
    } else if (first.type === "set_variable") {
        if (first.operator !== "=") {
            throwSyntaxError(code, pos, "Expected a regular equals sign for the default value of an argument.");
        }
        return {
            name: first.name.value,
            default: first.ready
        };
    } else if (first.type === "symbol" && first.value === "...") {
        if (tokens.length !== 2 || tokens[1].type !== "word") {
            throwSyntaxError(code, first.pos, "Expected only a variable name after the spread operator.");
        }
        return {
            name: tokens[1].value,
            spread: true
        };
    } else throwSyntaxError(code, first.pos, "Invalid function argument.");
}

const TokenHandlers = [
    function (code, index, tokens, statements) {
        const token = tokens[index];
        if (token.type !== "return") return null;
        statements.push({
            type: "return",
            pos: token.pos,
            ready: token.ready
        });
        return ++index;
    },
    function (code, index, tokens, statements) {
        if (!checkSyntax(tokens, index, [
            [["value", "function"]], [["type", "word"]], [["type", "group"], ["sym", "("]]
        ])) return null;
        const fnTkn = tokens[index++];
        const name = tokens[index++];
        const group = tokens[index++];
        const got = findEOS(code, index, tokens, statements);
        if (!got) {
            throwSyntaxError(code, fnTkn.pos, "Expected the function declaration to have an 'end' keyword at the end of its scope.")
        }
        index = got[0];
        const args = [];
        const split = splitToCommas(group.children);
        for (let i = 0; i < split.length; i++) {
            const c = split[i];
            const arg = processFunctionArgument(code, group.pos, c);
            if (arg.spread && i !== split.length - 1) {
                throwSyntaxError(code, group.pos, "No arguments can be added after a variadic argument.");
            }
            args.push(arg);
        }
        statements.push({
            type: "function_declaration",
            pos: mkPos(fnTkn.pos.start, got[2].pos.end),
            name: name.value,
            arguments: args,
            statements: got[1]
        });
        return ++index;
    },
    function (code, index, tokens) {
        if (!checkSyntax(tokens, index, [
            [["value", "function"]], [["type", "group"], ["sym", "("]]
        ])) return null;
        return null;
    },
    function (code, index, tokens, statements) {
        const token = tokens[index];
        if (token.type === "operator" || token.type === "symbol") {
            throwSyntaxError(code, token.pos, "Didn't expect a symbol-like at the beginning of an expression.");
        }
        const eoe = findEOE(code, tokens, index);
        const got = tokens.slice(index, eoe);
        statements.push({
            type: "execution",
            pos: mkPos(got[0].pos.start, got.at(-1).pos.end),
            ready: makeShun(got)
        });
        return eoe;
    }
];

function processToken(code, index, tokens, statements) {
    for (const handler of TokenHandlers) {
        const res = handler(code, index, tokens, statements);
        if (res !== null) return res;
    }
    throwSyntaxError(code, tokens[index].pos, "Unexpected token.");
}

function parseGroups(code, tokens) {
    if (tokens.length === 0) return [];
    const statements = [];

    let index = 0;
    while ((index = processToken(code, index, tokens, statements)) < tokens.length) {
    }

    return statements;
}

module.exports = {parseGroups};