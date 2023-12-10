const {mkPos, findEOE, throwSyntaxError, makeShun} = require("./utils");

function checkSyntax(tokens, index, expectations) {
    for (let i = 0; i < expectations.length; i++) {
        if (!(index + i in tokens)) return false;
        const token = tokens[index + i];
        const exp = expectations[i];
        if (exp.some(i => token[i[0]] !== i[1])) return false;
    }
    return true;
}

const TokenHandlers = [
    function (code, index, tokens) {
        if (!checkSyntax(tokens, index, [
            [["type", "word"]], [["type", "set"]]
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