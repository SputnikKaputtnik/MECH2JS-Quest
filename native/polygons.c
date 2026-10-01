/* @portOnly Experimental batched equivalent of drawPipeline/polyDepthKey and
 * polygonColour, followed by ordinary world fill emission. TS is the oracle.
 * No pointers into JS, imports, allocation, threads, libc or mutable game state.
 * Unsigned operations specify wrap explicitly. Signed right shifts target Wasm.
 * Outlines/map/wireframe are handled by the unchanged TS renderer. */
typedef int i32;
typedef unsigned u32;
typedef long long i64;
typedef unsigned long long u64;
typedef unsigned char u8;
#define EXPORT(name) __attribute__((export_name(name)))
#define VMAX 4096
#define PMAX 8192
#define IMAX 65536
#define SMAX 131072
/* ABI (32-bit words): config = eye xyz, depth row xyz, near, far, sort,
 * ambient, directional, light xyz, dim distance, damage raises, ramp, texture mask.
 * Vertex = world xyz, model xyz, UV. Polygon = count, normal xyz, code,
 * owner type/flags/present, fan start/capacity, sprite start/valid, index offset.
 * Result = queued, draw dirty, geometry-change count. Change = polygon,
 * 1(write clipped)/2(restore base), number of vertex slots. No heap growth. */
static i32 config[20], vertices[VMAX][8], polys[PMAX][13], indices[IMAX];
static i32 depths[VMAX], vflags[VMAX], roots[1024];
static float draw[SMAX], positions[SMAX*3], uvs[SMAX*2];
static u8 clipped[PMAX];
static i32 changes[PMAX][3], result[4];
typedef struct { i32 a,b,num,den; } Rec;
static Rec recs[VMAX*2];
static i32 count;
EXPORT("address") void *address(i32 which) {
  switch(which) {
    case 0:return config; case 1:return vertices; case 2:return polys;
    case 3:return indices; case 4:return roots; case 5:return draw;
    case 6:return positions; case 7:return uvs; case 8:return clipped;
    case 9:return changes; case 10:return result; default:return 0;
  }
}
static i32 sub(i32 a,i32 b) {return (u32)a-(u32)b;}
static i32 add(i32 a,i32 b) {return (u32)a+(u32)b;}
static i32 mul(i32 a,i32 b) {return (u32)a*(u32)b;}
static i32 div32(i32 a,i32 b) {return (i32)((i64)a/b);}
static u64 dot(i32 a,i32 b,i32 c,i32 d,i32 e,i32 f) {
  return (u64)((i64)a*b)+(u64)((i64)c*d)+(u64)((i64)e*f);
}
static void depth(i32 v) {
  if(vflags[v]&4)return;
  i32 *p=vertices[v];
  u64 d=dot(config[3],sub(p[0],config[0]),config[4],sub(p[1],config[1]),config[5],sub(p[2],config[2]));
  i32 z=(u32)(d>>27)+((d>>26)&1);
  depths[v]=z; vflags[v]=4|(z<config[6]?1:0)|(z>config[7]?2:0);
}
static void vertex(i32 a) { recs[count++]=(Rec){a,-1,0,1}; }
static void cross(i32 a,i32 b) {
  if(depths[a]>depths[b]){i32 t=a;a=b;b=t;}
  recs[count++]=(Rec){a,b,sub(config[6],depths[a]),sub(depths[b],depths[a])};
}
static i32 clip(i32 *p,i32 *key) {
  i32 n=p[0], *ix=indices+p[12], first=ix[0];
  if(n>=3) {
    i32 *f=vertices[first];
    if((i64)dot(sub(f[0],config[0]),p[1],sub(f[1],config[1]),p[2],sub(f[2],config[2]),p[3])>=0)return 0;
  }
  i32 all=3;
  for(i32 i=0;i<n;i++){depth(ix[i]);all&=vflags[ix[i]];}
  if(all==1||all==2)return 0;
  count=0;
  i32 prev=first, pn=vflags[first]&1, fn=pn;
  if(!fn)vertex(first);
  for(i32 i=1;i<n;i++) {
    i32 b=ix[i],bn=vflags[b]&1;
    if(bn!=pn)cross(prev,b);
    prev=b;pn=bn;if(!bn)vertex(b);
  }
  if(fn!=pn)cross(prev,first);
  if(count<=2&&n>=3)return 0;
  i32 flags=config[8], k=flags&4?0x7fffffff:(i32)0x80000001;
  u32 sum=0;
  for(i32 i=0;i<count;i++) {
    i32 d=recs[i].b<0?depths[recs[i].a]:config[6];
    sum+=(u32)d;
    if(flags&4){if(d<k)k=d;}else if(d>k)k=d;
  }
  if(flags&2) k=count?(i32)(sum/(u32)count):0;
  *key=flags&1?k|0x40000000:k;
  return 1;
}
static i32 light(i32 *p) {
  i32 *v=vertices[indices[p[12]]];
  i32 dx=sub(config[11],config[10]?0:v[0]),dy=sub(config[12],config[10]?0:v[1]),dz=sub(config[13],config[10]?0:v[2]);
  u32 ax=dx<0?0u-(u32)dx:(u32)dx,ay=dy<0?0u-(u32)dy:(u32)dy,az=dz<0?0u-(u32)dz:(u32)dz;
  u32 bits=ax|ay|az;if(!bits)return 127;
  i32 shift=24-__builtin_clz(bits);
  if(shift>0){ax>>=shift;ay>>=shift;az>>=shift;}else if(shift<0){ax<<=-shift;ay<<=-shift;az<<=-shift;}
  u32 sum=(ax&255)*(ax&255)+(ay&255)*(ay&255)+(az&255)*(az&255);
  i32 len=(short)roots[sum>>8];
  if(!len)return 0x10000; /* Request whole-mesh fallback, without JS mutation. */
  /* The TS reference adds three products unbounded before >>16. Decompose
   * them into floor quotients and unsigned remainders to retain that 66-bit sum. */
  i64 a=(i64)dx*p[1],b=(i64)dy*p[2],c=(i64)dz*p[3];
  i64 q=(a>>16)+(b>>16)+(c>>16)+(((a&65535)+(b&65535)+(c&65535))>>16);
  if(shift>0)q>>=shift;else if(shift<0)q=(i64)((u64)q<<-shift);
  return (short)(q/len);
}
static i32 colour(i32 *p,i32 distance,i32 *ok) {
  i32 code=p[4],type=p[5],flags=p[6],mode=code&0x7000,slot=0,base;
  if(mode<0x3000) {
    if(mode==0)return config[16]?((code&255)>>6)|0xf0:(code&0xff0)>>4;
    if(mode==0x2000){*ok=0;return 0;}
    base=code&255;
  }else if(mode==0x3000) {
    if(!config[17]||!(type&config[17]))return code;
    base=code&0xf0;mode=0x1000;
  }else if(mode>=0x5000) {
    base=255;
    if(!config[17])slot=code&255;
    else if(!(config[17]&0x100)||(!(type&0x100)&&(type&0xf0)!=0x50)) {
      if(!(config[17]&type))slot=code&255;else {mode=0x1000;base=0xd0;}
    }else {mode=0x1000;base=0xa0;}
  }else base=code&255;
  i32 intensity=light(p);if(intensity==0x10000){*ok=0;return 0;}
  i32 shade=div32(mul(base>>1,add(mul(intensity,sub(128,config[9]))>>7,config[9])),0x440);
  if(config[14])shade=sub(shade,div32((u32)distance<<4,config[14])>>4);
  if(shade<1)shade=0;else if(shade>15)shade=15;
  i32 damage=(flags&255)>>4;
  if(((type&0x100)||(type&0xf0)==0x50)&&damage) {
    if(!config[15]) {u32 s=mul(mul(16-damage,0x1000),shade);shade=((s>>16)+((s>>15)&1))&15;}
    else {i64 d=(i64)damage*((15-shade)*65536/15);shade=add(shade,(i32)(d>>16)+(i32)((d>>15)&1));}
  }
  i32 ramp=0;
  if(mode>=0x5000)shade=(u32)shade<<8;
  else {if(config[16])return mode|slot|0xf0|shade;ramp=(code&0xf00)>>4;}
  return ramp|mode|slot|shade;
}
static void emit(i32 slot,Rec r,i32 baked) {
  i32 *a=vertices[r.a],*b=r.b<0?a:vertices[r.b];
  for(i32 k=0;k<3;k++) {
    i32 axis=(baked?0:3)+k;
    double value=a[axis];
    if(r.b>=0)value+=((double)b[axis]-a[axis])*r.num/r.den;
    positions[slot*3+k]=(float)(value*(k==2?-0.01:0.01));
  }
  for(i32 k=0;k<2;k++) {
    i32 val=(u32)a[6+k]<<16;
    if(r.b>=0&&r.den)val=add(val,(i32)((i64)sub((u32)b[6+k]<<16,val)*r.num/r.den));
    uvs[slot*2+k]=(float)((double)val/65536);
  }
}
EXPORT("process") i32 process(i32 nv,i32 np,i32 baked) {
  result[0]=result[1]=result[2]=0;
  for(i32 i=0;i<nv;i++)vflags[i]=0;
  for(i32 i=0;i<np;i++) {
    i32 *p=polys[i];if(!p[7])continue;
    i32 key=0,queued=clip(p,&key),word=-1,crossing=0;
    if(queued) {
      i32 ok=1;word=colour(p,key,&ok);if(!ok)return -1;
      result[0]++;
      for(i32 k=0;k<count;k++)if(recs[k].b>=0)crossing=1;
    }
    i32 tris=0,sprite=0;
    if(crossing) {
      i32 fan=count-2;if(fan>p[9])fan=p[9];
      i32 s=p[8];for(i32 k=1;k<=fan;k++){emit(s++,recs[0],baked);emit(s++,recs[k],baked);emit(s++,recs[k+1],baked);}
      i32 *change=changes[result[2]++];change[0]=i;change[1]=1;change[2]=fan*3;clipped[i]=1;
    }else if(clipped[i]) {
      i32 *change=changes[result[2]++];change[0]=i;change[1]=2;change[2]=p[9]*3;clipped[i]=0;
    }
    if(p[0]>=3&&word!=-1) {
      if((word&0x7000)==0x3000)sprite=p[10]>=0&&p[11]==1&&!crossing;
      else {tris=crossing?count-2:p[0]-2;if(tris>p[9])tris=p[9];}
    }
    for(i32 t=0;t<p[9];t++) {
      i32 w=t<tris?word:-1,s=p[8]+t*3;
      if(draw[s]!=w){draw[s]=draw[s+1]=draw[s+2]=w;result[1]=1;}
    }
    if(p[10]>=0) {
      i32 w=sprite?word:-1,s=p[10];
      if(draw[s]!=w){for(i32 k=0;k<6;k++)draw[s+k]=w;result[1]=1;}
    }
  }
  return result[0];
}
