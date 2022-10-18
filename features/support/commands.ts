import {When} from "@cucumber/cucumber";

When('I ask the stick to wave device {string}', async function (serial) {
    try {
        this['response'] = await this['wms'].wave(serial);
    } catch (e) {
        this['response'] = e;
    }
});
