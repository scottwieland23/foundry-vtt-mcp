const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(t,b){const type=Buffer.from(t),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(b.length);sum.writeUInt32BE(crc(Buffer.concat([type,b])));return Buffer.concat([len,type,b,sum]);}
function png(w,h){const hdr=Buffer.alloc(13);hdr.writeUInt32BE(w);hdr.writeUInt32BE(h,4);hdr[8]=8;hdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(Buffer.alloc((w*4+1)*h))),chunk('IEND',Buffer.alloc(0))]);}
const dir=path.resolve(__dirname,'../outputs');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'vhalzareth-portrait.png'),png(1254,1254));
fs.writeFileSync(path.join(dir,'long-table-fountain-square.png'),png(1448,1086));
