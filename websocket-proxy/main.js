import fs from 'node:fs';
import readline from 'node:readline';
import childProcess from 'node:child_process';

const MODULE_DIR = './modules';
const CONFIG_FILE = './config.json';
const PERSISTENT_STORAGE = './persistentStorage.json';

class HAServices {
    config = {};
    persistentStorage = {};
    loadedModules = [];

    async _start() {
        // Config
        if(fs.existsSync(CONFIG_FILE)) {
            this.config = JSON.parse(fs.readFileSync(CONFIG_FILE));
        }
        
        // Persistent storage
        if(fs.existsSync(PERSISTENT_STORAGE)) {
            this.persistentStorage = JSON.parse(fs.readFileSync(PERSISTENT_STORAGE));
        } else {
            fs.writeFileSync(PERSISTENT_STORAGE, '{}');
        }
        
        // Load modules
        if(!fs.existsSync(MODULE_DIR)) {
            fs.mkdirSync(MODULE_DIR);
        }
        const availableModules = fs.readdirSync(MODULE_DIR, { withFileTypes: true });
        // TODO: automatically sort by dependencies before load
        for(let moduleFile of availableModules) {
            if(!moduleFile.isFile() || !moduleFile.name.endsWith('.module.js')) continue;
            try {
                const modulePath = `${moduleFile.parentPath}/${moduleFile.name}`;
                const moduleMeta = await this._readMeta(modulePath);
                console.log(`Loading module ${moduleMeta.id} from ${moduleFile.name}`);

                if(moduleMeta.modDeps) {
                    for(let dependency of moduleMeta.modDeps) {
                        if(!Object.keys(this.loadedModules).find(module => module == dependency))
                            throw new Error(`Depends on module ${dependency} which is not loaded`);
                    }
                }
                if(moduleMeta.libDeps && !process.env.SKIP_LIB_INSTALL) {
                    await this._installLibDeps(moduleMeta.libDeps);
                }

                const module = (await import(modulePath)).default;
                module.meta = moduleMeta;
                const moduleClass = new module(this);
                this.loadedModules[moduleMeta.id] = moduleClass;
            } catch(err) {
                console.error(`Error loading module from ${moduleFile.name}:`, err);
            }
        }

        for(let [moduleId, moduleClass] of Object.entries(this.loadedModules)) {
            try {
                await moduleClass.start();
            } catch(err) {
                console.error(`Error starting module from ${moduleId}:`, err);
            }
        }
    }

    _installLibDeps(dependencies) {
        let install = false;
        if(fs.existsSync('package.json')) {
            const packageJson = JSON.parse(fs.readFileSync('package.json'));
            dependencies.forEach(dep => {
                if(!packageJson.dependencies[dep]) install = true;
            });
        } else {
            install = true;
        }
        if(install) {
            console.log('Installing dependencies '+dependencies.join(', '));
            let args = ['install', '--no-fund', '--no-audit', ...dependencies];
            return this.execSystemCommand('npm', args);
        }
    }

    async _readMeta(modulePath) {
        const stream = fs.createReadStream(modulePath);
        const reader = readline.createInterface({ input: stream });
        let metaLine = await new Promise((resolve) => {
            reader.on('line', (line) => {
                reader.close();
                resolve(line);
            });
        });
        stream.close();
        metaLine = metaLine.replace('//', '').trim();
        try {
            const meta = JSON.parse(metaLine);
            if(!meta.id) throw new Error('Metadata field "id" missing');
            return meta;
        } catch(err) {
            throw new Error(`Cannot parse meta "${metaLine}"`);
        }
    }

    execSystemCommand(cmd, args) {
        return new Promise((resolve, reject) => {
            const proc = childProcess.spawn(cmd, args);
            if(this.debug) console.log(cmd+' '+args.join(' '));
            
            let buffer = '', errbuffer = '';
            proc.stdout.on('data', data => buffer += data);
            proc.stderr.on('data', data => errbuffer += data);
    
            proc.on('close', code => {
                if(code != 0) {
                    reject(new Error(errbuffer.trim()));
                    return;
                }
                resolve(buffer);
            });
    
            proc.on('error', err => {
                reject(new Error(err));
            });
        });
    }

    savePersistentStorage() {
        fs.writeFileSync(PERSISTENT_STORAGE, JSON.stringify(this.persistentStorage));
    }
}
new HAServices()._start();
