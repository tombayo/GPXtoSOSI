const xmlParser = require('xml2json')
const fs = require('fs/promises')
const fetch = require('node-fetch')

main(process.argv).catch(console.dir)


async function main([,,path]) {
  console.log('Reading...',path)
  let xmldata = await parseXmlFile(path)
  console.log('Conversing with API...')
  let geodata = await convertGeoData(xmldata)
  console.log('Generating file...')
  let sosi = await generateSOSI(geodata)
  console.log('Writing to disk...')
  let result = await writeSOSI(sosi,path)
  console.log('Done!')

  return result
}

async function parseXmlFile(path) {
  let data = await fs.readFile(path)
  let xmldata = JSON.parse(xmlParser.toJson(data))
  let gpx = xmldata.gpx
  
  if (typeof(gpx) == "undefined") throw new Error('File is not a GPX file.')

  let wpt = gpx.wpt ?? []
  let rte = gpx.rte?.rtept ?? []

  let gpxdata = wpt.concat(rte)
  
  if (!gpxdata.length) {
    throw new Error('No wpt or rte tag found in xml file!')
  }

  return gpxdata
}

async function convertGeoData(xmljson) {
  var coords = []
  
  for (let i=0;i<xmljson.length;i++) {
    let {name=i, lat, lon, ele=0} = xmljson[i]

    coords.push(convertCoord(name,lat,lon,ele))
  }
  
  let converted = await Promise.all(coords).then(data => { return data })
  
  return converted
}

async function apiCall(lat, lon) {
  let response = await fetch(`https://ws.geonorge.no/transApi/?ost=${lon}&nord=${lat}&fra=84&til=22`)

  return response.json()
}

async function convertCoord(id,lat,lon,ele) {
  let converted = await apiCall(lat,lon)
  converted.hoyde = (1*ele).toSOSI(3)
  converted.navn = id
  converted.ost = converted.ost.toSOSI(3)
  converted.nord = converted.nord.toSOSI(3)
  return converted
}

Number.prototype.toSOSI = function (accuracy) {
  return this.toFixed(accuracy).toString().replace('.','')
}

function generateSOSIcoords(coordObjects) {
  let coordSOSIstring = ''
  let [maxlat,minlat] = [0,Infinity]
  let [maxlon,minlon] = [0,Infinity]

  for (let { ost, nord, hoyde } of coordObjects) {
    coordSOSIstring += `${nord} ${ost} ${hoyde}\n`

    maxlat = (maxlat < ost)?ost:maxlat
    minlat = (minlat > ost)?ost:minlat
    maxlon = (maxlon < nord)?nord:maxlon
    minlon = (minlon > nord)?nord:minlon
  }

  let minmaxArea = {maxlat,minlat,maxlon,minlon}
  return {coordSOSIstring, minmaxArea}
}
function generateSOSIarea({maxlat,minlat,maxlon,minlon}) {
  return `..OMRÅDE
  ...MIN-NØ ${parseInt(minlon.slice(0,-3))-10} ${parseInt(minlat.slice(0,-3))-10}
  ...MAX-NØ ${parseInt(maxlon.slice(0,-3))+10} ${parseInt(maxlat.slice(0,-3))+10}`
}

function generateSOSIset(setID, type, typename, coordObjects) {
  let { coordSOSIstring, minmaxArea } = generateSOSIcoords(coordObjects)
  let SOSIarea = generateSOSIarea(minmaxArea)

  let SOSIset = `.${type} ${setID}:
  ..OBJTYPE ${typename}
  ..NØH
  ${coordSOSIstring}`

  return {SOSIset, SOSIarea}
}

function generateSOSI(coordObjects) {
  let {SOSIset, SOSIarea} = generateSOSIset(1,'KURVE', 'TeleFibertrase', coordObjects)

  let SOSIheader = 
  `.HODE 0:
  ..TEGNSETT UTF-8
  ..TRANSPAR
  ...KOORDSYS 22
  ...ORIGO-NØ 0 0
  ...ENHET 0.001
  ..PRODUSENT "NTE Elektro AS"
  ..SOSI-VERSJON 4.0
  ..SOSI-NIVÅ 2
  ${SOSIarea}\n`

  return {SOSIheader, SOSIsets:SOSIset}
}

async function writeSOSI({SOSIheader,SOSIsets},path) {
  let [folder,file] = path.split('/')

  let result = await fs.writeFile(`sosi/${file}.sos`, (SOSIheader+SOSIsets+'.SLUTT').replace(/  +/g,''))

  return result
}