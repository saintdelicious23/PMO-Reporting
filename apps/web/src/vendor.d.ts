declare module "pdfmake/build/pdfmake" {
  interface PdfDocument { download(filename?:string):Promise<void>; }
  interface PdfMake { addVirtualFileSystem(vfs:Record<string,string>):void; createPdf(definition:unknown):PdfDocument; }
  const pdfMake:PdfMake;
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const vfs:Record<string,string>;
  export default vfs;
}
