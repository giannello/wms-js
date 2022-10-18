import {When} from "@cucumber/cucumber";

When('I ask for the stick name', async function () {
    this['response'] = await this['wms'].getName();
});

When('I ask for the stick version', async function () {
    this['response'] = await this['wms'].getVersion();
});
