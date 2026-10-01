/* @portOnly RGBA packing and HUD layer reductions. Matches HudOverlay.update;
 * palette indices and layer bytes stay exact. No GPU, allocator or imports. */
typedef unsigned char u8;
typedef unsigned u32;
#include <wasm_simd128.h>
#define MAX_PIXELS 1048576
#define EXPORT(n) __attribute__((export_name(n)))
static u8 pixels[MAX_PIXELS], drawn[MAX_PIXELS], layer[MAX_PIXELS], inset[MAX_PIXELS];
static u32 output[MAX_PIXELS];
static double result[11];
EXPORT("address") void *address(int which) {
  switch(which){case 0:return pixels;case 1:return drawn;case 2:return layer;
    case 3:return inset;case 4:return output;case 5:return result;default:return 0;}
}
static double rx,ry;
static int rn,rl,rt,rr,rb,ml,mt,mr,mb;
static void reduce(int i,int width,int is_reticle) {
  int x=i%width,y=i/width;
  if(is_reticle) {
    rx+=x;ry+=y;rn++;
    if(x<rl)rl=x;if(x>rr)rr=x;if(y<rt)rt=y;if(y>rb)rb=y;
  }else {
    if(x<ml)ml=x;if(x>mr)mr=x;if(y<mt)mt=y;if(y>mb)mb=y;
  }
}
EXPORT("pack") void pack(int width,int height,int reticle,int marker) {
  rx=ry=0;rn=0;rl=ml=width;rt=mt=height;rr=rb=mr=mb=-1;
  int n=width*height;
  v128_t zero=wasm_i8x16_splat(0),white=wasm_i8x16_splat(-1);
  v128_t ret=wasm_i8x16_splat(reticle),mark=wasm_i8x16_splat(marker);
  int i=0;
  for(;i+16<=n;i+=16) {
    v128_t p=wasm_v128_load(pixels+i),l=wasm_v128_load(layer+i),k=wasm_v128_load(inset+i);
    v128_t mask=wasm_i8x16_ne(wasm_v128_load(drawn+i),zero);
    v128_t g=wasm_v128_and(mask,wasm_i8x16_sub(white,l));
    v128_t rg0=wasm_i8x16_shuffle(p,g,0,16,1,17,2,18,3,19,4,20,5,21,6,22,7,23);
    v128_t rg1=wasm_i8x16_shuffle(p,g,8,24,9,25,10,26,11,27,12,28,13,29,14,30,15,31);
    v128_t ba0=wasm_i8x16_shuffle(k,zero,0,16,1,17,2,18,3,19,4,20,5,21,6,22,7,23);
    v128_t ba1=wasm_i8x16_shuffle(k,zero,8,24,9,25,10,26,11,27,12,28,13,29,14,30,15,31);
    wasm_v128_store(output+i,wasm_i8x16_shuffle(rg0,ba0,0,1,16,17,2,3,18,19,4,5,20,21,6,7,22,23));
    wasm_v128_store(output+i+4,wasm_i8x16_shuffle(rg0,ba0,8,9,24,25,10,11,26,27,12,13,28,29,14,15,30,31));
    wasm_v128_store(output+i+8,wasm_i8x16_shuffle(rg1,ba1,0,1,16,17,2,3,18,19,4,5,20,21,6,7,22,23));
    wasm_v128_store(output+i+12,wasm_i8x16_shuffle(rg1,ba1,8,9,24,25,10,11,26,27,12,13,28,29,14,15,30,31));
    u32 rmask=wasm_i8x16_bitmask(wasm_v128_and(mask,wasm_i8x16_eq(l,ret)));
    u32 mmask=wasm_i8x16_bitmask(wasm_v128_and(mask,wasm_i8x16_eq(l,mark)));
    u32 bits=rmask|mmask;
    while(bits){int bit=__builtin_ctz(bits);reduce(i+bit,width,(rmask>>bit)&1);bits&=bits-1;}
  }
  for(;i<n;i++) {
    int l=drawn[i]?layer[i]:-1;
    output[i]=(u32)pixels[i]|(u32)(l<0?0:255-l)<<8|(u32)inset[i]<<16;
    if(l==reticle||l==marker)reduce(i,width,l==reticle);
  }
  result[0]=rx;result[1]=ry;result[2]=rn;result[3]=rl;result[4]=rt;result[5]=rr;result[6]=rb;
  result[7]=ml;result[8]=mt;result[9]=mr;result[10]=mb;
}
