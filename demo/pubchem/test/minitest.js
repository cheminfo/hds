var hds = require('hds'),
    Kind = hds.Kind,
    Entry = hds.Entry;

hds.init(function () {

    require('./../hds-kinds');

    var doc = { kind: 'entry',
        value: { cId: '1' },
        children:
            [ { kind: 'mf', value: { mf: 'C9H17NO4' } },
                { kind: 'iupac',
                    value: { val: '3-acetoxy-4-(trimethylammonio)butanoate' } },
                { kind: 'iupac',
                    value: { val: '3-acetyloxy-4-(trimethylammonio)butanoate' } },
                { kind: 'iupac',
                    value: { val: '3-acetyloxy-4-(trimethylazaniumyl)butanoate' } },
                { kind: 'iupac',
                    value: { val: '3-acetyloxy-4-(trimethylazaniumyl)butanoate' } },
                { kind: 'iupac',
                    value: { val: '3-acetoxy-4-(trimethylammonio)butyrate' } } ] };

    Entry.insertTree(doc, function (err, res) {
        console.log(err)
        res.getChildren(function (err, res) {
            console.log(res)
        })
    })

});