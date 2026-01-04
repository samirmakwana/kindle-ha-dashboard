export class HAModule {
    constructor(main) {
        this.main = main;
        this.config = main.config[this.constructor.meta.id];
    }

    start() {}

    log(...msg) {
        console.log(`[${this.constructor.meta.id}]`, ...msg);
    }

    logError(...msg) {
        console.error(`[${this.constructor.meta.id}]`, ...msg);
    }
}
