db.documents.find({'films': {$elemMatch: {'name': /^.*明星.*/}}}).pretty()