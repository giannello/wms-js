import {defineParameterType} from "@cucumber/cucumber";

defineParameterType({
    name: "boolean",
    regexp: /true|false/,
    transformer: (s) => s === "true"
});