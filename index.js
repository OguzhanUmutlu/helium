const {tokenize, groupTokens} = require("./src/lexer");
const {parseGroups} = require("./src/parser");
const {interpret} = require("./src/interpreter");

const code = `
y = {x: 10}
print(y.x+=10 * 2)
print(y)
`;

const tokens = tokenize(code);
const groups = groupTokens(code, tokens);
const statements = parseGroups(code, groups);

interpret(code, statements);