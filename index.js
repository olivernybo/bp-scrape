import fs from 'fs'
import path from 'path'
import screenshot from 'screenshot-desktop'
import sharp from 'sharp'

import fetch from 'node-fetch';
import FormData from 'form-data';

import dotenv from 'dotenv'
import { Environment } from 'env-types';

dotenv.config()
Environment.load()

screenshot.listDisplays().then(async displays => {
	const display = displays[0]

	const img = await screenshot({ screen: display.id })

	const __dirname = path.resolve()
	const imgPath = path.join(__dirname, 'temp.jpg')

	// save the image to the current directory as temp.jpg
	fs.writeFileSync(imgPath, img)

	/*
	<area target="" alt="description" title="description" href="" coords="141,527,727,870" shape="rect">
    <area target="" alt="price" title="price" href="" coords="860,775,1207,873" shape="rect">
    <area target="" alt="title" title="title" href="" coords="1046,314,1510,224" shape="rect">
	*/

	const handler = async ({ data, info }) => {
		const { width, height, channels } = info

		for (let i = 0; i < data.length; i += channels) {
			const [r, g, b, a] = data.slice(i, i + 4)

			const isWhiteIsh = r > 200 && g > 200 && b > 200

			if (!isWhiteIsh) {
				data[i] = 0
				data[i + 1] = 0
				data[i + 2] = 0
			}
		}

		return { data, info }
	}

	const blueHandler = async ({ data, info }) => {
		const { width, height, channels } = info

		for (let i = 0; i < data.length; i += channels) {
			const [r, g, b, a] = data.slice(i, i + 4)

			const isBlueIsh = b > 150

			if (!isBlueIsh) {
				data[i] = 0
				data[i + 1] = 0
				data[i + 2] = 0
			} else {
				data[i] = 255
				data[i + 1] = 255
				data[i + 2] = 255
			}
		}

		return { data, info }
	}

	// extract the area for each element
	const title = await sharp(imgPath).extract({ left: 1046, top: 220, width: 464, height: 100 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(handler)
	const description = await sharp(imgPath).extract({ left: 141, top: 550, width: 550, height: 300 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(blueHandler)
	const price = await sharp(imgPath).extract({ left: 860, top: 775, width: 347, height: 98 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(handler)

	const titlePath = path.join(__dirname, 'title.jpg')
	const descriptionPath = path.join(__dirname, 'description.jpg')
	const pricePath = path.join(__dirname, 'price.jpg')

	// save the extracted area
	await sharp(title.data, {
		raw: title.info
	}).toFile(titlePath)

	await sharp(description.data, {
		raw: description.info
	}).toFile(descriptionPath)

	await sharp(price.data, {
		raw: price.info
	}).toFile(pricePath)


	// read files as base64
	const titleBase64 = fs.readFileSync(titlePath, 'base64')
	const descriptionBase64 = fs.readFileSync(descriptionPath, 'base64')
	const priceBase64 = fs.readFileSync(pricePath, 'base64')

	// get the text from the images
	const titleOCR = await getOCR(titleBase64)
	const descriptionOCR = await getOCR(descriptionBase64)
	const priceOCR = await getOCR(priceBase64)

	const titleText = titleOCR.ParsedResults[0].ParsedText.replace(/\n/g, ' ').replace(/\s\s+/g, ' ').trim()
	let descriptionText = descriptionOCR.ParsedResults[0].ParsedText//.replace(/\n/g, ' ')
	const priceText = priceOCR.ParsedResults[0].ParsedText.replace(/\s/g, '').replace('.', '').replace('HSP', '')

	// find [text] in the description, if so, a property under the price is added and it's removed from the description
	const regex = /\[(.*?)\]/g
	const matches = descriptionText.match(regex)

	console.log(titleText)
	console.log(descriptionText)
	console.log(priceText)

	let body = `---\nprice: ${priceText}\n`

	let bakugan = ''

	if (matches) {
		console.log('found bakugan')
		matches.forEach(match => {
			bakugan = match.replace('[', '').replace(']', '')
			body += `bakugan: ${bakugan}\n`
			descriptionText = descriptionText.replace(match, '')
		})
	}

	descriptionText = descriptionText.replace(/\n/g, ' ').replace(/\s\s+/g, ' ').trim()

	body += '---\n'

	// find atribute in bakugan. it's either pyrus, aquos, ventus, haos, darkus or subterra, may be capitalized
	const atributeRegex = /(pyrus|aquos|ventus|haos|darkus|subterra)/gi
	const atributeMatches = bakugan.match(atributeRegex)

	let wrappedBakugan = ''
	// if bakugan doesn't include an atribute, wrap it in [[ ]]
	if (!atributeMatches) {
		wrappedBakugan = `[[${bakugan}]]`
	} else {
		// if it does, wrap only the bakugan name in [[ ]]
		const bakuganName = bakugan.replace(atributeRegex, '').trim()
		const atribute = atributeMatches[0]
		wrappedBakugan = `${atribute} [[${bakuganName}]]`
	}

	// wrap all atributes in [[ ]]
	const atributes = descriptionText.match(atributeRegex)
	let newDescription = descriptionText.replace(regex, '').trim().replace(bakugan, wrappedBakugan)
	if (atributes) {
		['Pyrus', 'Aquos', 'Ventus', 'Haos', 'Darkus', 'Subterra'].forEach(atribute => {
			newDescription = newDescription.replaceAll(atribute, `[[${atribute}]]`)
		})
	}
	
	body += `${newDescription}`

	// save the text to a file
	fs.writeFileSync(path.join(__dirname, 'cards', `${titleText}.md`), body)

	process.exit(0)
})


async function getOCR(base64Image) {

	// The url to the API
	const url = 'https://api.ocr.space/parse/image';

	// The headers to send with the request
	const headers = {
		apiKey: Environment.OCR_KEY
	};

	// The data to send with the request
	const form = new FormData();
	form.append('isOverlayRequired', 'false');
	form.append('base64Image', `data:image/jpg;base64,${base64Image}`);
	form.append('OCREngine', '1');
	form.append('iscreatesearchablepdf', 'false');
	form.append('issearchablepdfhidetextlayer', 'false');
	//form.append('scale', 'true');
	form.append('filetype', 'JPG');

	// Send the request
	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: form
	});

	// Get the response as JSON
	const json = await response.json();

	return json;
}