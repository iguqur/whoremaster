const secret = require('./secret')
const puppeteer = require('puppeteer')
const sleep = require('sleep')

let browser
let page
let datas = []

const TimeOut = 1000 * 60 * 3

const getRandomSleepTime = () => {
  return Math.floor(Math.random() * 10) + 10
}

const randomSleep = () => {
  sleep.sleep(getRandomSleepTime())
}

const crawTorrent = async (url) => {
  await page.goto(url, {timeout: TimeOut, waitUntil: 'domcontentloaded'})
  const content = await page.$('.dlboxbg')

  const href = await page.evaluate((body) => {
    for (let node of body.childNodes) {
      if (node.nodeName === 'A' && node.innerText === '下載檔案') {
        return node.href
      }
    }
    return ''
  }, content)
  await content.dispose()
  return href
} // 获取torrent

const crawlExhibition = async (url) => {
  await page.goto(url, {timeout: TimeOut, waitUntil: 'domcontentloaded'})
  const content = await page.$('.tpc_content #read_tpc')

  const getedfilms = await page.evaluate((body) => {
    let films = [] // 所有的片
    let film = {
      name: '',
      fomat: '',
      size: '',
      duration: '',
      describe: '',
      imgs: [],
      href: ''
    }
    let getHref = false
    let isNewOne = true // 是否是开始新的
    let lastHref = '' // 上一个地址

    let pushNewOne = () => {
      let {...newFilm} = film
      films.push(newFilm)
      film.imgs = []
      isNewOne = true
    }
    for (let node of body.childNodes) {
      switch (node.nodeName) {
        case 'BR': { // <br>
          break
        }
        case '#text': { // text
          let text = node.nodeValue
          if (text.length > 4) { // 过滤掉没用的文本
            if (/影片名称/.test(text) || /影片名稱/.test(text)) { // 处理链接前面没有‘下载地址’的情况
              if (!isNewOne) {
                film.href = lastHref
                pushNewOne()
              }
              isNewOne = false
              film.name = text.slice(7)
            } else if (/影片格式/.test(text)) {
              film.fomat = text.slice(7)
            } else if (/影片大小/.test(text)) {
              film.size = text.slice(7)
            } else if (/影片时间/.test(text)) {
              film.duration = text.slice(7)
            } else if (/影片说明/.test(text) || /有码无码/.test(text)) {
              film.describe = text.slice(7)
            } else if (/下载地址/.test(text)) {
              getHref = true
            }
          }
          break
        }
        case 'IMG': { // <img>
          film.imgs.push(node.src)
          break
        }
        case 'A': { // <a>
          lastHref = node.href
          if (getHref) { // 处理图片放在<a>下面的情况
            getHref = false
            film.href = node.href

            // 以链接地址结束
            pushNewOne()
          }
          break
        }
        default: {
          console.error('未处理类型：', node.nodeName)
          break
        }
      }
    }
    return films
  }, content)
  await content.dispose()
  return getedfilms
} // 获取每一页的内容

const crawlAListPage = async (url) => {
  await page.goto(url, {timeout: TimeOut, waitUntil: 'domcontentloaded'})
  let columns = await page.$$('tbody .tr3 td h3') // 每一栏的数据 列表
  for (let column of columns) {
    try {
      let title = await column.$eval('a', node => node.innerText) // 每一栏的标题是什么
      let a = await column.$('a')
      let hrefJSHandle = await a.getProperty('href')
      const href = hrefJSHandle._remoteObject.value

      const idJSHandle = await a.getProperty('id')
      const id = idJSHandle._remoteObject.value

      const matchStrs = [
        /国产高清/,
        /国产無碼/,
        /国产无码/
      ]
      for (let matchStr of matchStrs) {
        if (matchStr.test(title)) {
          let data = {
            id,
            title,
            href
          }
          datas.push(data)
          break
        }
      }
    } catch (e) {
      console.error('获取一行数据失败！', url, e)
    }
  }
} // 获取列表中的内容

const run = async () => {
  const MongoClient = require('mongodb').MongoClient

  let client = await MongoClient.connect('mongodb://localhost:27017')
  let db = client.db('whoremaster')

  const collection = db.collection('documents')

  browser = await puppeteer.launch()
  page = await browser.newPage()

  for (let i = 1; i <= 140; ++i) {
    let url = secret.homeUrl + '&page=' + i + '.html'
    console.log('---- 开始获取列表：', url)

    try {
      await crawlAListPage(url)
    } catch (e) {
      console.error('获取列表失败', url, e)
      continue
    }

    randomSleep()

    for (let data of datas) {
      console.log('---- ---- 开始获取页面内容：', data.href)

      try {
        data.films = await crawlExhibition(data.href)
      } catch (e) {
        console.error('获取页面失败！', data.href, e)
        continue
      }

      randomSleep()

      for (let film of data.films) {
        console.log('---- ---- ---- 开始获取种子：', film.href)

        try {
          film.torrent = await crawTorrent(film.href)
        } catch (e) {
          console.error('获取种子失败！', film.href, e)
        }

        randomSleep()
      }
    }
    try {
      console.log('---- 开始存储数据！')
      await collection.insertMany(datas)
    } catch (e) {
      console.error('存储数据库失败！', e)
    }
    datas = []
    // console.log(datas)
  }

  await browser.close()
  client.close()
}

run()

let test = async () => {
  browser = await puppeteer.launch()
  page = await browser.newPage()
  let films = await crawlExhibition('')
  console.error(films, films.length)
  await browser.close()
}

// test()
