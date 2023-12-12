const {tokenize, groupTokens} = require("./src/lexer");
const {parseGroups} = require("./src/parser");
const {interpret} = require("./src/interpreter");

const code = `
a = [1,2,3,4]

a[0] = 10
`;

const tokens = tokenize(code);
const groups = groupTokens(code, tokens);
console.log(groups)
const statements = parseGroups(code, groups);

interpret(code, statements, {
    type: "main",
    parent: null,
    variables: {}
});