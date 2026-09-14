use klever_sc_scenario::*;

fn world() -> ScenarioWorld {
    let mut blockchain = ScenarioWorld::new();

    blockchain.register_contract(
        "kleversc:output/token-factory.kleversc.json",
        token_factory::ContractBuilder,
    );
    blockchain
}

#[test]
fn empty_rs() {
    world().run("scenarios/token_factory.scen.json");
}
