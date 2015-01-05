
# Getting started

This guide will tell you the basics about the system and define some terminology. Then it will show you using an example how to setup a database, store documents and attachments and query for them.  
If you need more information about a specific component of the system, go back to the [table of contents](README.md#table-of-contents)

## Why use HDS ?

This library was designed with one main problematic in mind : how to store in a simple way hierarchical data, while having distinguishable kinds of information and a powerful way to query on this data ?  
It also has to be quite easy to add a new kind of information or a new property to an existing kind. Then the system must be able to handle permissions on the data elements.

HDS allows you to define an unlimited number of data structures and will store each kind of information in its own Mongo DB collection. Information about the relationship of the data items is stored in the document itself.

## Terminology

__Database__

The Mongo DB system that HDS is communicating with. It can be a single database on one server or a complex replica set.

__Entry__

A single document in Mongo DB. It is identified by a `kind` and its `id`.

__Kind__

Represents a type of information. All entries of the same kind are stored in the same collection.
They share a common data structure. The most basic queries are made over only one kind.

__Child__

An entry that belongs directly to another one is called a child. Entries can have many children but only one direct parent.

__Ancestor__

Any entry that is in the parent path of another one is called an ancestor

## Example : catalog of chemicals

To illustrate how the system works, we will introduce a concrete example.
A chemical company wants to store its catalog in a hierarchical way.

**TODO - CONTINUE EXAMPLE**

## Configure the system

### 1. Requirements

**TODO talk about promises and node 0.11**

### 2. Initialization

First we must initialize the connection with Mongo DB.

```js
hds.init({
  database: {
    host: 'localhost',
    name: 'chemicals'
  }
}).then(hdsReady)
```

You can see that `init` returns a `Promise`. This is the case for most of the asynchronous methods of HDS.

### 3. Define kinds

Before inserting data, you must define the different kinds that will be used by the application.

```js
hds.Kind.create('catalogEntry', {
  id: {
    type: String,
    required: true
  },
  name: String,
  cat: [String]
});
```

This is the kind definition for first level catalog entries. The kind's name is 'catalogEntry'
and all documents belonging to this kind can have three different properties : an id (which is mandatory), a name and an array of categories.

The schema definition can be written exactly like in [mongoose](http://mongoosejs.com/docs/guide.html) with one difference: main property names cannot start with a '_' (used by HDS for special fields)

```js
hds.Kind.create('iupac', {
  name: String,
  lang: {
    type: String,
    'default': 'en'
  }
});
```

## Insert data

### 4. Create an entry

When kinds are defined, you can easily create and save entries.

```js
var entry1 = hds.Entry.create('catalogEntry', { id: 'A123' }, { owner: 'user1@example.com' });
entry1.save().then(function () {
  var iupac1 = entry1.createChild('iupac', { name: 'Ethanol' });
  var iupac2 = entry1.createChild('iupac', { name: 'Éthanol', lang: 'fr' });
  var saveChildren = [iupac1, iupac2].map(function (iupac) { return iupac.save() });
  Promise.all(saveChildren).then(function() {
    // both children are saved
  });
});
```

Here we created one catalog entry with two iupac names as children. Note that the parent entry must be saved before creating a child or the creatChild method will throw.
We can also add attachments to saved entries :

```js
entry1.createAttachment({
  content: fs.readFileSync('/my/entries/ethanol.pdf'),
  contentType: 'application/pdf',
  filename: 'MSDS.pdf'
}).then(...);
```

## Look for data

### 5. Search entries of one kind

You can easily do simple queries using with mongoose :

```js
hds.Entry.findOne('catalogEntry', { id: 'A123' }, { name: 1 }).exec().then(...);
```

The call is proxied to mongoose's [model](http://mongoosejs.com/docs/api.html#model_Model.find) for `find` and `findOne` methods.

When you have an entry, you can retrieve its children:

```js
// Get all children of the same kind
myEntry.getChildren({ kind: 'iupac' }).then(...);

// Get all first-level children mapped by kind
myEntry.getChildren({ groupKind: true }).then(...);
```
