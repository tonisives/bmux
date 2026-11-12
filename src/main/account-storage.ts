// Runs in an isolated world. Preserve structured IndexedDB values without evaluating site code.
let codec = `
let encode = async (value, seen = new Set()) => {
  if (value === undefined) return {t:'undefined'};
  if (typeof value === 'bigint') return {t:'bigint',v:String(value)};
  if (typeof value === 'number' && !Number.isFinite(value)) return {t:'number',v:String(value)};
  if (value === null || typeof value !== 'object') return {t:'primitive',v:value};
  if (seen.has(value)) throw new Error('ACCOUNT_STORAGE_CYCLE');
  seen.add(value);
  try {
    if (value instanceof Date) return {t:'date',v:value.toISOString()};
    if (value instanceof Blob) return {t:'blob',type:value.type,v:Array.from(new Uint8Array(await value.arrayBuffer()))};
    if (value instanceof ArrayBuffer) return {t:'buffer',v:Array.from(new Uint8Array(value))};
    if (ArrayBuffer.isView(value)) return {t:'view',name:value.constructor.name,v:Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
    if (value instanceof Map) return {t:'map',v:await Promise.all(Array.from(value,async ([k,v])=>[await encode(k,seen),await encode(v,seen)]))};
    if (value instanceof Set) return {t:'set',v:await Promise.all(Array.from(value,v=>encode(v,new Set(seen))))};
    if (Array.isArray(value)) return {t:'array',v:await Promise.all(value.map(v=>encode(v,new Set(seen))))};
    if (Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null) throw new Error('ACCOUNT_STORAGE_TYPE');
    return {t:'object',v:await Promise.all(Object.entries(value).map(async ([k,v])=>[k,await encode(v,new Set(seen))]))};
  } finally {seen.delete(value)}
};
let decode = data => {
  switch(data.t) {
    case 'undefined':return undefined;
    case 'primitive':return data.v;
    case 'bigint':return BigInt(data.v);
    case 'number':return Number(data.v);
    case 'date':return new Date(data.v);
    case 'blob':return new Blob([new Uint8Array(data.v)],{type:data.type});
    case 'buffer':return new Uint8Array(data.v).buffer;
    case 'view': {
      let types={Uint8Array,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,Uint8ClampedArray,BigInt64Array,BigUint64Array,DataView};
      if (!types[data.name]) throw new Error('ACCOUNT_STORAGE_TYPE');
      return new types[data.name](new Uint8Array(data.v).buffer);
    }
    case 'array':return data.v.map(decode);
    case 'object':return Object.fromEntries(data.v.map(([k,v])=>[k,decode(v)]));
    case 'map':return new Map(data.v.map(([k,v])=>[decode(k),decode(v)]));
    case 'set':return new Set(data.v.map(decode));
    default:throw new Error('ACCOUNT_STORAGE_TYPE');
  }
};
let result = request => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('ACCOUNT_STORAGE_FAILED'))});
let done = tx => new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(new Error('ACCOUNT_STORAGE_FAILED'))});
`
export let exportAccountStorage = `(async()=>{${codec}
  let databases=[];
  for (let info of await indexedDB.databases()) {
    let db=await result(indexedDB.open(info.name)), stores=[];
    try {
      for (let name of db.objectStoreNames) {
        let tx=db.transaction(name,'readonly'), completion=done(tx), store=tx.objectStore(name);
        let indexes=Array.from(store.indexNames,name=>{let index=store.index(name);return {name,keyPath:index.keyPath,unique:index.unique,multiEntry:index.multiEntry}});
        let [keys,values]=await Promise.all([result(store.getAllKeys(null,2001)),result(store.getAll(null,2001))]); await completion;
        if(keys.length>2000)throw new Error('ACCOUNT_TRANSFER_TOO_LARGE');
        stores.push({name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes,keys:await encode(keys),values:await encode(values)});
      }
      databases.push({name:info.name,version:db.version,stores});
    } finally {db.close()}
  }
  return {origin:location.origin,local:Object.entries(localStorage),session:Object.entries(sessionStorage),databases};
})()`
export let importAccountStorage = (value: unknown) => `(async()=>{${codec}
  let data=${JSON.stringify(value).replaceAll('<', '\\u003c')};
  if(location.origin!==data.origin)throw new Error('ACCOUNT_STORAGE_ORIGIN');
  for(let [key,value] of data.local)localStorage.setItem(key,value);
  for(let [key,value] of data.session)sessionStorage.setItem(key,value);
  for(let database of data.databases){
    let request=indexedDB.open(database.name,database.version);
    request.onupgradeneeded=()=>{for(let store of database.stores){let target=request.result.createObjectStore(store.name,{keyPath:store.keyPath,autoIncrement:store.autoIncrement});for(let index of store.indexes)target.createIndex(index.name,index.keyPath,{unique:index.unique,multiEntry:index.multiEntry})}};
    let db=await result(request);
    try{for(let store of database.stores){let tx=db.transaction(store.name,'readwrite'),completion=done(tx),target=tx.objectStore(store.name),keys=decode(store.keys),values=decode(store.values);for(let i=0;i<values.length;i++)store.keyPath===null?target.put(values[i],keys[i]):target.put(values[i]);await completion}}finally{db.close()}
  }
})()`
